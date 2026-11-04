// Draws the current Omarchy theme's backdrop between the wallpaper and the
// windows, inside the frame Hyprland is drawing, from the windows' geometry in
// that frame, so it never trails them.
//
// A theme with a backdrop ships backdrop.frag, a fragment shader written
// against contract.glsl. The user's Hyprland config loads this plugin once a
// session and nothing unloads it. A theme switch reloads Hyprland's config:
// the shader and palette are read again from the applied theme then, and a
// theme without backdrop.frag leaves the plugin idle (no draw, no timer).
//
// Hyprland advances its animations, then emits render.pre, then reads the
// frame's damage. At render.pre the plugin reads the windows as they will be
// drawn; if they differ from what it last drew, it damages the whole monitor
// and the glass, so this same frame draws the new backdrop. The backdrop's own
// motion runs on the desktop's: its clock runs while the windows move and
// eases to a stop after them (contract.glsl, `time`), so a still desktop
// draws nothing and asks for no frames.
//
// A backdrop can also draw text: the cinema-feed service sends the newest
// plaintext of the agents on this machine to a datagram socket the plugin owns,
// and a theme that ships glyphs.png draws it (specs/agent-rain.md).

#define WLR_USE_UNSTABLE

#include <hyprland/src/Compositor.hpp>
#include <hyprland/src/config/ConfigValue.hpp>
#include <hyprland/src/config/values/types/IntValue.hpp>
#include <hyprland/src/workspace/HLWorkspace.hpp>
#include <hyprland/src/desktop/state/Fadeout.hpp>
#include <hyprland/src/desktop/state/FadingOutState.hpp>
#include <hyprland/src/desktop/state/FocusState.hpp>
#include <hyprland/src/desktop/state/WindowState.hpp>
#include <hyprland/src/desktop/view/window/Window.hpp>
#include <hyprland/src/desktop/view/window/WindowEffectsController.hpp>
#include <hyprland/src/desktop/view/window/WindowPresentation.hpp>
#include <hyprland/src/event/EventBus.hpp>
#include <hyprland/src/managers/SessionLockManager.hpp>
#include <hyprland/src/managers/fullscreen/FullscreenController.hpp>
#include <hyprland/src/output/Monitor.hpp>
#include <hyprland/src/plugins/PluginAPI.hpp>
#include <hyprland/src/render/OpenGL.hpp>
#include <hyprland/src/render/Renderer.hpp>
#include <hyprland/src/render/WindowRenderPresentation.hpp>
#include <hyprland/src/render/decorations/IHyprWindowDecoration.hpp>
#include <hyprland/src/render/pass/PassElement.hpp>
#include <hyprland/src/render/shaders/Shaders.hpp>
#include <hyprland/src/state/MonitorState.hpp>
#include <hyprland/src/state/workspace/State.hpp>

#include <hyprland/src/render/gl/GLFramebuffer.hpp>
#include <hyprland/src/output/MonitorResources.hpp>
#include <GLES3/gl32.h>
#include <cairo/cairo.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#include <array>
#include <chrono>
#include <charconv>
#include <cstring>
#include <deque>
#include <cmath>
#include <filesystem>
#include <format>
#include <fstream>
#include <numeric>
#include <regex>
#include <sstream>
#include <unordered_map>
#include <unordered_set>

using namespace Render::GL;

namespace {

    constexpr double FOCUS_EASE  = 0.32; // seconds
    // A window's velocity eases over this long, so one late frame does not
    // spike it.
    constexpr double VELOCITY_EASE = 0.08; // seconds
    // What happened lately (specs/depth.md, part 1): the last IMPULSES things,
    // each gone IMPULSE_LIFE after it happened. Kinds as contract.glsl names them.
    constexpr size_t IMPULSES     = 32;
    constexpr double IMPULSE_LIFE = 3.0; // seconds
    enum eImpulse : int {
        IMPULSE_OPEN = 1,
        IMPULSE_CLOSE,
        IMPULSE_LAND,
        IMPULSE_FOCUS,
    };
    // The most windows a monitor's scene holds: the contract's Windows block
    // has room for this many, three vec4s each.
    constexpr size_t WINDOWS_MAX = 256;
    // The feed's snapshot: "CFD1", generation (u64), count and next position
    // (u32), little-endian like this machine, then the ring of characters.
    constexpr size_t FEED_RING   = 16384;
    constexpr size_t FEED_HEADER = 20;
    constexpr int    FEED_BUDGET = 8; // datagrams taken per wakeup, at most
    constexpr auto   FEED_STALE  = std::chrono::seconds(10);
    constexpr float  FEED_EASE   = 3.F; // seconds for the text to come or drain away
    // Voice (specs/depth.md): "CVO1", loudness (f32, 0 to 1), speaking (u32).
    // A reading older than VOICE_STALE is silence: the feed or Voxtype stopped.
    constexpr size_t VOICE_SIZE  = 12;
    constexpr auto   VOICE_STALE = std::chrono::milliseconds(500);
    // The lettering is 16 by 6 cells; anything larger than this is not an
    // atlas, and is refused from its header before it is decoded.
    constexpr uint32_t GLYPHS_MAX_WIDTH = 1024, GLYPHS_MAX_HEIGHT = 512;

    const char* CONTRACT =
#include "contract.inc"
        ;

    // `area` is what is drawn, in logical px from the screen's top left
    // (origin, size): the whole screen for the backdrop, a window's band for
    // its frame. `proj` places it in the target, render modifiers included.
    const char* VERTEX = R"(#version 300 es
uniform mat3 proj;
uniform vec4 area;
in vec2 pos;
out vec2 v_px;
out vec2 v_uv;
void main() {
    gl_Position = vec4(proj * vec3(pos, 1.0), 1.0);
    v_px = area.xy + pos * area.zw;
    v_uv = gl_Position.xy * 0.5 + 0.5;
}
)";

    // The two things a film's shader can draw: the world, and (if it defines
    // frame()) each window's edge in it (main-backdrop.glsl, main-frame.glsl).
    const char* BACKDROP_MAIN =
#include "main-backdrop.inc"
        ;
    const char* FRAME_MAIN =
#include "main-frame.inc"
        ;
    // The plugin's own copy of a texture's level over the framebuffer
    // bound, pixel for pixel (`size` is the framebuffer's): drawn, as a blit
    // cost more here (0.31 against 0.24 ms at 1440x900).
    const char* COPY = R"(#version 300 es
precision highp float;
uniform sampler2D source;
uniform float level;
uniform vec2 size;
out vec4 fragColor;
void main() {
    fragColor = textureLod(source, gl_FragCoord.xy / size, level);
}
)";
    // How far outside a window its frame may draw, in logical px.
    constexpr double FRAME_BAND = 48.0;
    // The world's clock (contract.glsl, `time`) runs at a speed that eases
    // toward 1 over STIR_RISE while the scene changed within STIR_HOLD, and
    // back toward 0 over STIR_FALL after; below STIR_STILL it stops.
    constexpr double STIR_RISE = 0.15, STIR_FALL = 0.5, STIR_HOLD = 0.05, STIR_STILL = 0.005; // seconds, and a speed

    using Rect = std::array<float, 4>;

    // A window as the backdrop sees it: where it is drawn, how faded, how round,
    // how it moves, how far it is lifted toward the viewer, how deep in the
    // stack it sits (0 on top).
    struct SShape {
        Rect                 rect{};
        float                alpha    = 1;
        float                rounding = 0;
        std::array<float, 2> velocity{};
        float                lift  = 0;
        float                depth = 0;
        uint64_t             id    = 0; // the window's stable id, kept by its fadeout; 0 for none
        bool                 operator==(const SShape&) const = default;
    };

    // What the backdrop shows on one monitor, apart from its own motion.
    struct SScene {
        std::vector<SShape> shapes;
        int                 focusedIndex = -1;
        Rect                focus{};
        float               focusAlpha = 0; // how present the focus is (contract.glsl)
        Rect                reserved{}; // room the bar and other panels keep: top, right, bottom, left
        bool                operator==(const SScene&) const = default;
    };

    // What the world shows besides the windows: what it answers (specs/depth.md,
    // part 3), the agents' text and its own clock. A change here draws it
    // again, glass and all.
    struct SAnswer {
        uint64_t             impulses = 0; // the impulse ring's generation
        float                voice    = 0; // speech loudness, 0 to 1
        float                presence = 0; // how present the agents' text is (contract.glsl, feedPresence)
        float                time     = 0; // the world's clock (contract.glsl, `time`)
        bool                 operator==(const SAnswer&) const = default;
    };

    // How something moves between frames, so its velocity is known and its
    // lift eases. Kept by a window's stable id.
    struct SMotion {
        Vector2D                              at;
        std::array<float, 2>                  velocity{};
        float                                 lift   = 0;
        bool                                  moving = false;
        std::chrono::steady_clock::time_point seen;
    };

    // A closed window as its fadeout still needs it.
    struct SClosed {
        float    rounding = 0;
        uint64_t id       = 0;
    };

    struct SImpulse {
        Vector2D                              at; // global logical px
        std::chrono::steady_clock::time_point start;
        float                                 strength = 1;
        int                                   kind     = 0;
        uint64_t                              window   = 0; // the stable id of the window it happened to, 0 for none
    };

    struct SMonitor {
        SScene                                pending; // read for the frame being drawn
        SScene                                drawn;
        SAnswer                               answer; // read for the frame being drawn
        SAnswer                               answered;
        // What the focus decoration follows: the focused window, or, once it
        // has closed with nothing else focused here, its fadeout until that
        // has faded. A source is a window's stable id, which its fadeout
        // keeps; 0 is none. Any change of source eases from what was drawn.
        PHLWINDOWREF                          focusedWindow;
        WP<Desktop::IFadeout>                 focusFadeout;
        uint64_t                              source         = 0;
        Rect                                  focusFrom{};
        float                                 alphaFrom = 0;
        std::chrono::steady_clock::time_point focusMoved;
        bool                                  seen = false;
        // Whether the frame being drawn changes the world, which keeps
        // easing after it: the next frame is drawn too.
        bool                                  changed = false;
        // Whether the world changed since the half-size world and the frost
        // were last drawn here: they are kept until it does.
        bool                                  stale = true;
    };

    // One of the film's programs, the backdrop's or the frame's, and where
    // its uniforms are.
    struct SProgram {
        GLuint id = 0;
        GLint  proj, area, resolution, time, accent, background, foreground, focused, reserved, windowCount, focusedIndex, focusAlpha;
        GLint  feedUniform, feedCount, feedPos, glyphsUniform, feedPresence;
        GLint  impulses, impulseKinds, impulseWindows, impulseCount, voice, frameWindow, frameAlpha, frameBorder, drawnWorld, worldProj;
    };

    // A monitor's world as it was last drawn whole, kept until the world
    // changes: at half its size, with its mipmap down to the level as soft
    // as the film's frost; `proj` places the monitor in it, for the frames
    // that read it (worldAt()). With it, the agents' text it was drawn with
    // (the feed change, its count and next position), so a part of the
    // screen drawn again at rest shows the text the kept world does.
    struct SCoarse {
        GLuint   texture = 0, fbo = 0, feed = 0;
        int      width = 0, height = 0, levels = 0;
        Mat3x3   proj;
        uint64_t feedUploaded = 0;
        uint32_t feedCount = 0, feedPos = 0;
        // The frost target last drawn whole: its framebuffer and size.
        GLuint   frosted = 0;
        Vector2D frostedSize;
    };

    void forget(const SCoarse& coarse) {
        glDeleteFramebuffers(1, &coarse.fbo);
        for (const auto texture : {coarse.texture, coarse.feed})
            if (texture)
                glDeleteTextures(1, &texture);
    }

    // What the film's programs draw with: the unit square, the windows'
    // uniform buffer, filled once a frame by the backdrop and read by every
    // frame after it, and the lettering.
    struct SGpu {
        GLuint   vao = 0, vbo = 0, windows = 0, glyphs = 0;
        bool     glyphsUploaded = false;
        SProgram backdrop, frame;
        // COPY's program, and where its uniforms are.
        GLuint   copy = 0;
        GLint    copyProj = -1, copyArea = -1, copySource = -1, copyLevel = -1, copySize = -1;
        std::unordered_map<MONITORID, SCoarse> coarse;
    };

    struct SState {
        HANDLE                                  handle = nullptr;
        std::string                             source; // the theme's shader, empty when it has none
        std::optional<std::string>              refused; // the theme and contract last refused, said once
        std::array<float, 3>                    accent{1, 1, 1}, background{0, 0, 0}, foreground{1, 1, 1}, muted{1, 1, 1};
        // The colours the theme paints backgrounds in: these turn to glass,
        // keeping `glass` of themselves (colors.toml's, 0.85 without one).
        std::vector<std::array<float, 3>>       backgrounds;
        float                                   glass = 0.85F;
        uint64_t                                generation = 1;
        uint64_t                                compiled   = 0;
        bool                                    framed     = false; // the film's shader defines frame()
        SGpu                                    gpu;
        // How far the windows' depth goes (specs/depth.md, "Tiers"): 0 is the
        // backdrop alone, with no answers, no frames and no facts moving.
        SP<Config::Values::CIntValue>           depth;
        // Each monitor's frames shown, and its sleep and wake, which can pass
        // without a frame.
        std::vector<CHyprSignalListener>        watches;
        std::string                             glassShader; // the surface shader in use, empty for Hyprland's own
        wl_event_source*                        settling = nullptr; // a settle() waiting for the loop
        // The world's clock (advance()): seconds of its own motion, wrapping
        // hourly; the speed it runs at; when it last ran on (none once the
        // world stood still everywhere); and when the scene last changed.
        float                                   time = 0;
        double                                  speed = 0;
        std::chrono::steady_clock::time_point   clocked, stirred;
        std::unordered_map<MONITORID, SMonitor> monitors;
        std::unordered_map<uint64_t, SMotion>   motion; // each window's, by stable id
        std::deque<SImpulse>                    impulses;
        uint64_t                                impulseGeneration = 0;
        // Voxtype's loudness, as the feed last sent it.
        float                                   voice = 0;
        std::chrono::steady_clock::time_point   voiceReceived;
        // Hyprland keeps a closed window's rounding inside its fadeout, out of
        // reach, and forgets which window it was, so the plugin keeps both
        // beside: each window fadeout's rounding and stable id from the moment
        // it is made until Hyprland lets it go.
        std::unordered_map<const void*, SClosed> closed;
        std::unordered_set<const void*>         seenFadeouts;
        // The window whose fadeout comes next, held until its radius is read:
        // a client can destroy it in the same call that closes it, and
        // rounding() reads only its rules and the config.
        PHLWINDOW                               closing;
        // The agents' text: the newest valid snapshot the feed sent, counted
        // by changes taken (a restarted feed counts its generations from 0
        // again), and when any valid one last came, which says it is alive.
        // The socket's path belongs to whichever Hyprland holds feed.lock.
        int                                     feedFd     = -1, feedLock = -1;
        std::string                             feedPath;
        wl_event_source*                        feedSource = nullptr;
        // When what the feed last said runs out with no datagram to say so,
        // and what it said as last heard: voice and whether there is text
        // (heard()).
        wl_event_source*                        stale = nullptr;
        std::pair<float, bool>                  heard{0.F, false};
        std::vector<uint8_t>                    feedRing   = std::vector<uint8_t>(FEED_RING, ' ');
        uint64_t                                feedGeneration = 0, feedChanges = 0;
        uint32_t                                feedCount = 0, feedPos = 0;
        std::chrono::steady_clock::time_point   feedReceived;
        // The feed said no agent is running: its last text is kept, to drain.
        bool                                    feedEmpty = true;
        // How present the text is: a timed move toward whether there is any,
        // from where it stood when that last changed, read against the clock
        // whenever it is drawn, so it takes FEED_EASE at any frame rate.
        bool                                    presenceTarget = false;
        float                                   presenceFrom   = 0;
        std::chrono::steady_clock::time_point   presenceChanged;
        // The theme's lettering (glyphs.png) as coverage, one byte a pixel,
        // and the file it was decoded from, so an unchanged one is not
        // decoded again on every config reload.
        std::vector<uint8_t>                    glyphPixels;
        int                                     glyphWidth = 0, glyphHeight = 0;
        std::string                             glyphStamp;
    };

    UP<SState> g;

    void settle();

    std::string themeDir() {
        const char* state = getenv("XDG_STATE_HOME");
        const char* home  = getenv("HOME");
        return (state && *state ? std::string(state) : std::string(home ? home : "") + "/.local/state") + "/omarchy/current/theme";
    }

    std::string readFile(const std::string& path) {
        std::ifstream     file(path);
        std::stringstream buffer;
        if (file)
            buffer << file.rdbuf();
        return buffer.str();
    }

    std::array<float, 3> hexColor(const std::string& hex) {
        const auto value = std::stoul(hex, nullptr, 16);
        return {((value >> 16) & 0xff) / 255.F, ((value >> 8) & 0xff) / 255.F, (value & 0xff) / 255.F};
    }

    // The lettering for drawing text, if the theme has any. A reload that
    // leaves the file as it was keeps what was decoded; a file over the atlas
    // bound is refused from its header, so a config reload never decodes
    // more than a small image. Cairo hands it over as premultiplied ARGB, of
    // which only the coverage is kept.
    void readGlyphs(const std::string& path) {
        std::error_code  error;
        const auto       size  = std::filesystem::file_size(path, error);
        const auto       mtime = error ? std::filesystem::file_time_type{} : std::filesystem::last_write_time(path, error);
        const auto       stamp = error ? std::string() : std::format("{}:{}:{}", path, size, mtime.time_since_epoch().count());
        if (!stamp.empty() && stamp == g->glyphStamp)
            return;
        g->glyphStamp = stamp;
        g->glyphPixels.clear();
        g->glyphWidth = g->glyphHeight = 0;
        if (stamp.empty())
            return;

        // PNG: an 8-byte signature, then IHDR's length and type, then its
        // width and height, big-endian.
        std::ifstream             file(path, std::ios::binary);
        std::array<uint8_t, 24>   header{};
        if (!file.read(reinterpret_cast<char*>(header.data()), header.size()) || std::memcmp(header.data() + 12, "IHDR", 4) != 0)
            return;
        const auto big = [&](int at) { return uint32_t(header[at]) << 24 | uint32_t(header[at + 1]) << 16 | uint32_t(header[at + 2]) << 8 | header[at + 3]; };
        if (big(16) > GLYPHS_MAX_WIDTH || big(20) > GLYPHS_MAX_HEIGHT)
            return;

        const auto image = cairo_image_surface_create_from_png(path.c_str());
        if (cairo_surface_status(image) == CAIRO_STATUS_SUCCESS && cairo_image_surface_get_format(image) == CAIRO_FORMAT_ARGB32) {
            const int  width = cairo_image_surface_get_width(image), height = cairo_image_surface_get_height(image);
            const int  stride = cairo_image_surface_get_stride(image);
            const auto pixels = cairo_image_surface_get_data(image);
            g->glyphPixels.resize(size_t(width) * height);
            for (int y = 0; y < height; y++)
                for (int x = 0; x < width; x++)
                    g->glyphPixels[size_t(y) * width + x] = (reinterpret_cast<const uint32_t*>(pixels + size_t(y) * stride)[x]) >> 24;
            g->glyphWidth  = width;
            g->glyphHeight = height;
        }
        cairo_surface_destroy(image);
    }

    // The contract version a line says, as digits, empty when it says none:
    // the line is "// omarchy-cinema contract N" and nothing else. A film's is
    // its first line; the contract's, the line after #version.
    std::string contractOf(std::string_view line) {
        static const std::regex VERSION(R"(// omarchy-cinema contract ([1-9][0-9]*)[ \t\r]*)");
        line = line.substr(0, line.find('\n'));
        std::match_results<std::string_view::const_iterator> match;
        return std::regex_match(line.begin(), line.end(), match, VERSION) ? match[1].str() : "";
    }

    // How much of a window's background a colors.toml's glass keeps: one
    // number (as Lua's tonumber reads it: spaces and a + allowed), 0 to 1;
    // 0.85 for anything else.
    float glassOf(std::string value) {
        // One sign at most: from_chars takes a minus, not a plus.
        if (value.starts_with('+') && value.size() > 1 && value[1] != '-' && value[1] != '+')
            value.erase(0, 1);
        float      glass        = 0;
        const auto [end, error] = std::from_chars(value.data(), value.data() + value.size(), glass);
        return error == std::errc{} && end == value.data() + value.size() && std::isfinite(glass) ? std::clamp(glass, 0.F, 1.F) : 0.85F;
    }

    // The theme's shader, palette and glass, from the theme Omarchy has just
    // applied. Any backdrop.frag makes the theme a film (as film.lua decides);
    // one written for another contract than this build's, or for none, is not
    // compiled: it would not draw what its film means, so the plugin says why
    // and draws nothing.
    void readTheme() {
        const auto        dir     = themeDir();
        const bool        film    = std::filesystem::exists(dir + "/backdrop.frag");
        auto              shader  = readFile(dir + "/backdrop.frag");
        static const auto ours    = contractOf(std::string_view(CONTRACT).substr(std::string_view(CONTRACT).find('\n') + 1));
        const auto        written = contractOf(shader);
        if (film && written != ours) {
            // Said once for each theme and the contract it claims.
            const auto refused = readFile(dir + ".name") + "\n" + written;
            if (refused != g->refused) {
                // Digits without leading zeros: the longer is the larger.
                const bool newer = written.size() != ours.size() ? written.size() > ours.size() : written > ours;
                const auto said  = written.empty() ? std::string("does not say which contract it is written for") : std::format("is written for contract {}", written);
                const auto fix   = newer ? "log in again to run the engine installed now, or update omarchy-cinema" : "update the theme";
                HyprlandAPI::addNotification(g->handle, std::format("[backdrop] this theme's backdrop.frag {}, and this engine draws contract {}: {}", said, ours, fix),
                                             CHyprColor{1.0, 0.2, 0.2, 1.0}, 15000);
            }
            g->refused = refused;
            shader.clear();
        } else
            g->refused.reset();
        g->source         = shader.empty() ? "" : std::string(CONTRACT) + "\n#line 1\n" + shader;
        static const std::regex FRAME(R"(\bvec4\s+frame\s*\()");
        g->framed         = std::regex_search(shader, FRAME);

        static const std::regex PALETTE(R"re(^\s*([a-z_]+)\s*=\s*"#([0-9a-fA-F]{6})")re");
        static const std::regex GLASS(R"re(^\s*glass\s*=\s*"\s*([^"\s]*)\s*")re");
        std::istringstream      colors(readFile(dir + "/colors.toml"));
        g->backgrounds.clear();
        g->glass = 0.85F;
        for (std::string line; std::getline(colors, line);) {
            std::smatch match;
            if (std::regex_search(line, match, GLASS))
                g->glass = glassOf(match[1]);
            if (!std::regex_search(line, match, PALETTE))
                continue;
            const auto name  = match[1].str();
            const auto value = hexColor(match[2]);
            if (name == "accent")
                g->accent = value;
            else if (name == "foreground")
                g->foreground = value;
            else if (name == "muted")
                g->muted = value;
            if (name == "background")
                g->background = value;
            if (name == "background" || name == "dark_background" || name == "darker_background" || name == "lighter_background")
                g->backgrounds.push_back(value);
        }

        readGlyphs(dir + "/glyphs.png");
        g->generation++;
        settle();
    }

    GLuint compileStage(GLenum stage, const std::string& source, std::string& log) {
        const GLuint shader = glCreateShader(stage);
        const char*  text   = source.c_str();
        glShaderSource(shader, 1, &text, nullptr);
        glCompileShader(shader);
        GLint ok = 0;
        glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
        if (!ok) {
            std::array<char, 2048> buffer{};
            glGetShaderInfoLog(shader, buffer.size(), nullptr, buffer.data());
            log = buffer.data();
            glDeleteShader(shader);
            return 0;
        }
        return shader;
    }

    void deleteProgram() {
        auto& gpu = g->gpu;
        for (const auto program : {gpu.backdrop.id, gpu.frame.id, gpu.copy})
            if (program)
                glDeleteProgram(program);
        for (const auto buffer : {gpu.vbo, gpu.windows})
            if (buffer)
                glDeleteBuffers(1, &buffer);
        if (gpu.vao)
            glDeleteVertexArrays(1, &gpu.vao);
        if (gpu.glyphs)
            glDeleteTextures(1, &gpu.glyphs);
        for (const auto& [id, coarse] : gpu.coarse)
            forget(coarse);
        gpu = {};
    }

    // Compiles and links one of the film's programs, the film's source with
    // `main` after it. A failure is reported once and leaves `p` empty.
    bool link(SProgram& p, const std::string& main, const char* what) {
        std::string  log;
        const GLuint vert = compileStage(GL_VERTEX_SHADER, VERTEX, log);
        const GLuint frag = vert ? compileStage(GL_FRAGMENT_SHADER, g->source + main, log) : 0;
        if (!vert || !frag) {
            if (vert)
                glDeleteShader(vert);
            HyprlandAPI::addNotification(g->handle, std::format("[backdrop] the theme's {} does not compile: {}", what, log), CHyprColor{1.0, 0.2, 0.2, 1.0}, 15000);
            return false;
        }
        p.id = glCreateProgram();
        glAttachShader(p.id, vert);
        glAttachShader(p.id, frag);
        glBindAttribLocation(p.id, 0, "pos");
        glLinkProgram(p.id);
        glDeleteShader(vert);
        glDeleteShader(frag);
        GLint ok = 0;
        glGetProgramiv(p.id, GL_LINK_STATUS, &ok);
        if (!ok) {
            HyprlandAPI::addNotification(g->handle, std::format("[backdrop] the theme's {} does not link", what), CHyprColor{1.0, 0.2, 0.2, 1.0}, 15000);
            glDeleteProgram(p.id);
            p = {};
            return false;
        }
        const auto at  = [&](const char* name) { return glGetUniformLocation(p.id, name); };
        p.proj          = at("proj");
        p.area          = at("area");
        p.resolution    = at("resolution");
        p.time          = at("time");
        p.accent        = at("accent");
        p.background    = at("background");
        p.foreground    = at("foreground");
        p.focused       = at("focused");
        p.reserved      = at("reserved");
        p.windowCount   = at("windowCount");
        p.focusedIndex  = at("focusedIndex");
        p.focusAlpha    = at("focusAlpha");
        p.feedUniform   = at("feed");
        p.feedCount     = at("feedCount");
        p.feedPos       = at("feedPos");
        p.glyphsUniform = at("glyphs");
        p.feedPresence  = at("feedPresence");
        p.impulses      = at("impulses");
        p.impulseKinds  = at("impulseKinds");
        p.impulseWindows = at("impulseWindows");
        p.impulseCount  = at("impulseCount");
        p.voice         = at("voice");
        p.frameWindow   = at("frameWindow");
        p.frameAlpha    = at("frameAlpha");
        p.frameBorder   = at("frameBorder");
        p.drawnWorld    = at("drawnWorld");
        p.worldProj     = at("worldProj");
        if (const GLuint block = glGetUniformBlockIndex(p.id, "Windows"); block != GL_INVALID_INDEX)
            glUniformBlockBinding(p.id, block, 0);
        return true;
    }

    // Builds the film's programs once per theme read; called with the render
    // context current. A backdrop that does not compile leaves the plugin
    // idle until the theme is read again; a frame that does not compile
    // leaves the windows without one.
    bool program() {
        if (g->compiled == g->generation)
            return g->gpu.backdrop.id != 0;
        g->compiled = g->generation;
        deleteProgram();
        if (g->source.empty() || !link(g->gpu.backdrop, BACKDROP_MAIN, "backdrop.frag"))
            return false;
        if (g->framed)
            link(g->gpu.frame, FRAME_MAIN, "frame()");
        {
            std::string  log;
            const GLuint vert = compileStage(GL_VERTEX_SHADER, VERTEX, log), frag = compileStage(GL_FRAGMENT_SHADER, COPY, log);
            auto&        gpu  = g->gpu;
            gpu.copy          = glCreateProgram();
            glAttachShader(gpu.copy, vert);
            glAttachShader(gpu.copy, frag);
            glBindAttribLocation(gpu.copy, 0, "pos");
            glLinkProgram(gpu.copy);
            glDeleteShader(vert);
            glDeleteShader(frag);
            gpu.copyProj   = glGetUniformLocation(gpu.copy, "proj");
            gpu.copyArea   = glGetUniformLocation(gpu.copy, "area");
            gpu.copySource = glGetUniformLocation(gpu.copy, "source");
            gpu.copyLevel  = glGetUniformLocation(gpu.copy, "level");
            gpu.copySize   = glGetUniformLocation(gpu.copy, "size");
        }

        auto& gpu = g->gpu;
        GLint vao = 0, buffer = 0;
        glGetIntegerv(GL_VERTEX_ARRAY_BINDING, &vao);
        glGetIntegerv(GL_ARRAY_BUFFER_BINDING, &buffer);
        // The unit square, as Hyprland's own quads are drawn.
        const std::array<float, 8> quad = {1, 0, 0, 0, 1, 1, 0, 1};
        glGenVertexArrays(1, &gpu.vao);
        glBindVertexArray(gpu.vao);
        glGenBuffers(1, &gpu.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, gpu.vbo);
        glBufferData(GL_ARRAY_BUFFER, sizeof(quad), quad.data(), GL_STATIC_DRAW);
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
        glBindVertexArray(vao);
        glBindBuffer(GL_ARRAY_BUFFER, buffer);

        glGenBuffers(1, &gpu.windows);
        glGenTextures(1, &gpu.glyphs);
        return true;
    }

    float easeOut(float t) {
        return 1.F - std::pow(1.F - t, 3.F);
    }

    // Moves `m` to `at` as seen `now`: its velocity eases toward the move over
    // the time since it was last seen, and its lift toward `lifted`. Returns
    // whether it stopped this frame after moving. A first sighting, or one
    // after a long gap, starts still; a second reading in the same frame (a
    // window on two monitors) changes nothing.
    bool step(SMotion& m, const Vector2D& at, bool lifted, std::chrono::steady_clock::time_point now) {
        const double dt = std::chrono::duration<double>(now - m.seen).count();
        if (m.seen == std::chrono::steady_clock::time_point{} || dt > 0.25) {
            m = {.at = at, .lift = m.lift, .seen = now};
            return false;
        }
        if (dt < 0.001)
            return false;
        const bool   moving = at != m.at;
        const double k      = 1.0 - std::exp(-dt / VELOCITY_EASE);
        const auto   moved  = (at - m.at) / dt;
        m.velocity[0] += float((moved.x - m.velocity[0]) * k);
        m.velocity[1] += float((moved.y - m.velocity[1]) * k);
        if (!moving && std::hypot(m.velocity[0], m.velocity[1]) < 1.F)
            m.velocity = {};
        const float target = lifted ? 1.F : 0.F;
        m.lift += float((target - m.lift) * (1.0 - std::exp(-dt / (FOCUS_EASE / 3.0))));
        if (std::abs(target - m.lift) < 0.002F)
            m.lift = target;
        const bool landed = m.moving && !moving;
        m.moving          = moving;
        m.at              = at;
        m.seen            = now;
        return landed;
    }

    // Something happened at `at`: every film answers it its own way. The
    // monitor it happened on draws again now; its age rides the backdrop's
    // own frames after that.
    bool covered(PHLMONITOR monitor);
    void forgetImpulses();

    // Whether the world moves on this monitor now: a theme with a backdrop,
    // animations on (Hyprland's animations:enabled is the one authority), the
    // session unlocked, and the monitor awake and not showing a fullscreen
    // window. Time stands still while it moves on no monitor.
    bool moves(const PHLMONITOR& monitor) {
        static auto ANIMATIONS = CConfigValue<Config::INTEGER>("animations:enabled");
        return g && !g->source.empty() && *ANIMATIONS && !g_pSessionLockManager->isSessionLocked() && monitor->m_enabled && monitor->m_dpmsStatus && !covered(monitor);
    }

    // Whether the world answers the desktop now, read at the moment it is
    // asked: depth on and the world moving on some monitor. Nothing is
    // collected while it does not.
    bool answering() {
        return g && g->depth->value() != 0 && std::ranges::any_of(State::monitorState()->monitors(), moves);
    }

    // Lets go of everything pending: impulses and the last voice reading.
    void letGo() {
        if (!g)
            return;
        forgetImpulses();
        g->voice = 0;
    }

    void forgetImpulses() {
        if (g->impulses.empty())
            return;
        g->impulses.clear();
        g->impulseGeneration++;
    }

    void addImpulse(const Vector2D& at, float strength, int kind, const PHLWINDOW& window) {
        if (!answering())
            return;
        g->impulses.push_back(
            {.at = at, .start = std::chrono::steady_clock::now(), .strength = strength, .kind = kind, .window = window ? window->metadata().stableID() : 0});
        if (g->impulses.size() > IMPULSES)
            g->impulses.pop_front();
        g->impulseGeneration++;
        if (const auto monitor = State::monitorState()->query().vec(at).run())
            g_pHyprRenderer->damageMonitor(monitor);
    }

    // A window's middle, where it is or where it is going, for the impulses it
    // makes; only for a window on a workspace being shown.
    void windowImpulse(const PHLWINDOW& w, Desktop::View::IGeometric::eGeometricValueType state, float strength, int kind) {
        if (!w || !w->m_workspace || !w->m_workspace->visible())
            return;
        addImpulse(w->position(state) + w->size(state) / 2.0, strength, kind, w);
    }

    bool isWindowFadeout(const SP<Desktop::IFadeout>& fadeout) {
        const auto plane = fadeout->plane();
        return plane == Desktop::FADEOUT_PLANE_WINDOW_TILED || plane == Desktop::FADEOUT_PLANE_WINDOW_FLOATING || plane == Desktop::FADEOUT_PLANE_WINDOW_OVER_FULLSCREEN;
    }

    // Hyprland emits window.close, then makes that window's fadeout in the
    // same call (Hyprland 0.57.0 src/desktop/view/window/Window.cpp:1623,
    // 1744), so the window fadeouts that appear after a close event belong to
    // the window it named. The radius is read here, once the fadeout exists, because in
    // between Hyprland may take the window out of fullscreen and apply its
    // rules again, as the fadeout's own copy sees. Run at each close event and
    // before reading a scene; forgets fadeouts Hyprland has let go.
    void claimFadeouts() {
        std::unordered_set<const void*> alive;
        for (const auto& fadeout : Desktop::fadingOutState()->fadeouts()) {
            if (!isWindowFadeout(fadeout))
                continue;
            alive.insert(fadeout.get());
            if (g->seenFadeouts.insert(fadeout.get()).second && g->closing) {
                g->closed[fadeout.get()] = {g->closing->presentation().rounding(), g->closing->metadata().stableID()};
                for (auto& [id, state] : g->monitors)
                    if (state.focusedWindow.lock() == g->closing)
                        state.focusFadeout = fadeout;
            }
        }
        g->closing.reset();
        std::erase_if(g->seenFadeouts, [&](const void* f) { return !alive.contains(f); });
        std::erase_if(g->closed, [&](const auto& entry) { return !alive.contains(entry.first); });
    }

    // Whether Hyprland, drawing window w with `drawn` in `ctx`, covers what is
    // under it opaque, its own pixels plus the frost under the rest. A film
    // session blends the frost in the window's own shader
    // (render:use_shader_blur_blend, which film.lua sets and the glass runs
    // in), where every pixel of a blurred surface comes out opaque, its colour
    // and alpha plus the frost under the rest, whatever its opacity or fade
    // (0.57.0 surface.frag, OpenGL.cpp:1488). What is left is whether
    // renderWindow draws w that way over all of its rect: blurred at all (not
    // in a snapshot, Renderer.cpp:663) with its plain blur (variant 0;
    // another may blur live or move on its own), not transformed, not
    // proportional, the client's visible region, if any, all of it, and a
    // surface smaller than its window not fading: renderWindow puts a frost of
    // its own under one, faded with the window (Renderer.cpp:740).
    bool frosted(Render::CRenderContext& ctx, const PHLWINDOW& w, const Render::SWindowRenderPresentation& drawn) {
        static auto BLEND        = CConfigValue<Config::INTEGER>("render:use_shader_blur_blend");
        static auto VARIANT      = CConfigValue<Config::INTEGER>("decoration:blur:variant");
        static auto PROPORTIONAL = CConfigValue<Config::INTEGER>("decoration:blur:proportional");
        const auto  surface      = w->wlSurface();
        const bool  whole        = surface && surface->resource() &&
            (surface->m_visibleRegion.empty() || CRegion(CBox{{}, surface->resource()->m_current.bufferSize}).subtract(surface->m_visibleRegion).empty());
        const bool  small        = surface && surface->small() && !surface->m_fillIgnoreSmall;
        return !ctx.m_renderingSnapshot && *BLEND && *VARIANT == 0 && !*PROPORTIONAL && w->shouldBlur(drawn) && !w->effects().hasActiveTransformers() && whole &&
            (!small || drawn.fadeAlpha >= 1.F);
    }

    // Where renderWindow draws w on `monitor` with the presentation it draws
    // with (workspace slides and the floating offset included): its top left
    // and size, logical px.
    std::pair<Vector2D, Vector2D> drawnBox(const PHLWINDOW& w, const Render::SWindowRenderPresentation& drawn, const PHLMONITOR& monitor) {
        return {w->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT) + drawn.workspaceOffset + drawn.floatingOffset - monitor->m_position,
                w->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT)};
    }

    // The windows Hyprland draws on this monitor in this frame, and those
    // fading out after closing, where they are drawn, the first WINDOWS_MAX
    // of them; and where attention is.
    SScene readScene(PHLMONITOR monitor, SMonitor& state) {
        const auto now = std::chrono::steady_clock::now();
        SScene     scene;
        const auto focused = Desktop::focusState()->window();
        PHLWINDOW  focusedHere;
        // Each shape's place in the order Hyprland draws it, lowest first
        // (Hyprland 0.57.0 src/render/Renderer.cpp:354-575, 1294-1330): the
        // normal workspace, then each special one in workspace-list order,
        // then pinned windows. Within a workspace: its tiled windows (the
        // focused one last), its tiled fadeouts, its floating windows, its
        // floating fadeouts; and with a fullscreen window, after those the
        // fullscreen window, the windows allowed over it, and the fadeouts
        // over it.
        enum ePass : int { TILED, TILED_FADEOUTS, FLOATING, FLOATING_FADEOUTS, FULLSCREEN, OVER_FULLSCREEN, OVER_FULLSCREEN_FADEOUTS };
        std::vector<double> stacking;
        const auto          drawOrder = [](const PHLWORKSPACE& workspace, int pass, double order) {
            int place = 0;
            if (workspace && workspace->type() == Workspace::eWorkspaceType::SPECIAL) {
                place = 1;
                for (const auto& other : State::Workspace::state()->workspaces()) {
                    if (other.lock() == workspace)
                        break;
                    place++;
                }
            }
            return place * 1e7 + pass * 1e6 + order;
        };
        double              order = 0;

        for (const auto& w : Desktop::windowState()->windows()) {
            order++;
            if (scene.shapes.size() == WINDOWS_MAX)
                break;
            if (!w->mapped() || w->isHidden() || !w->m_workspace || !g_pHyprRenderer->shouldRenderWindow(w, monitor))
                continue;
            // Where and how faded renderWindow draws it, from the presentation
            // it draws with, so the shape moves and fades with the window
            // through workspace slides, closing, fullscreen and layout changes.
            const auto drawn = w->presentation().renderPresentation();
            if (!drawn.alphaVisible)
                continue;
            // Its pass, as Hyprland chooses it; a floating window fading out
            // under a fullscreen one is drawn in none (pinned windows are
            // drawn in their own pass, whatever is fullscreen).
            const bool pinned     = (w->m_state & Desktop::View::WINDOW_STATE_PINNED) && w->isFloating();
            int        pass       = w->isFloating() ? FLOATING : TILED;
            const bool fullscreen = !pinned && Fullscreen::controller()->hasFullscreen(w->m_workspace);
            if (fullscreen && Fullscreen::controller()->isFullscreen(w))
                pass = FULLSCREEN;
            else if (fullscreen && w->isFloating()) {
                if (!w->shouldRenderOverFullscreen())
                    continue;
                pass = OVER_FULLSCREEN;
            }
            const auto [position, size] = drawnBox(w, drawn, monitor);
            if (w == focused) {
                scene.focusedIndex = scene.shapes.size();
                focusedHere        = w;
            }
            auto& motion = g->motion[w->metadata().stableID()];
            if (step(motion, position + monitor->m_position, w == focused, now))
                addImpulse(position + monitor->m_position + size / 2.0, std::clamp(float(std::hypot(motion.velocity[0], motion.velocity[1]) / 3000.0), 0.25F, 1.F),
                           IMPULSE_LAND, w);
            const bool still = g->depth->value() == 0;
            scene.shapes.push_back({{float(position.x), float(position.y), float(size.x), float(size.y)}, drawn.fadeAlpha, w->presentation().rounding(),
                                    still ? std::array<float, 2>{} : motion.velocity, still ? 0.F : motion.lift, 0.F,
                                    w->metadata().stableID()});
            if (pinned) {
                stacking.push_back(1e9 + order);
                continue;
            }
            stacking.push_back(drawOrder(w->m_workspace, pass, order + (pass == TILED && w == focused ? 1e5 : 0)));
        }

        // Closed windows fading out, on the workspaces Hyprland draws them on:
        // the active one and every special workspace still visible, even one
        // being dismissed (Hyprland 0.57.0 src/render/Renderer.cpp:1300, 3598).
        claimFadeouts();
        static auto ROUNDING = CConfigValue<Config::INTEGER>("decoration:rounding");
        for (const auto& fadeout : Desktop::fadingOutState()->fadeouts()) {
            const auto workspace = fadeout->workspace().lock();
            if (scene.shapes.size() == WINDOWS_MAX)
                break;
            if (fadeout->monitor() != monitor || !isWindowFadeout(fadeout) ||
                (workspace && workspace != monitor->m_activeWorkspace && !(workspace->type() == Workspace::eWorkspaceType::SPECIAL && workspace->m_alpha->value() > 0.F)))
                continue;
            const auto position = fadeout->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT) - monitor->m_position;
            const auto size     = fadeout->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
            const auto closed   = g->closed.find(fadeout.get());
            if (!focusedHere && fadeout == state.focusFadeout.lock())
                scene.focusedIndex = scene.shapes.size();
            // Only a fadeout already running when the plugin loaded has none.
            const auto window = closed != g->closed.end() ? closed->second : SClosed{float(*ROUNDING)};
            scene.shapes.push_back({{float(position.x), float(position.y), float(size.x), float(size.y)}, fadeout->alpha(), window.rounding, {}, 0, 0, window.id});
            const auto plane = fadeout->plane();
            stacking.push_back(drawOrder(workspace,
                                         plane == Desktop::FADEOUT_PLANE_WINDOW_TILED            ? TILED_FADEOUTS :
                                             plane == Desktop::FADEOUT_PLANE_WINDOW_FLOATING ? FLOATING_FADEOUTS :
                                                                                               OVER_FULLSCREEN_FADEOUTS,
                                         fadeout->zIndex()));
        }
        // Depth, 0 on top.
        std::vector<size_t> rank(stacking.size());
        std::iota(rank.begin(), rank.end(), 0);
        std::ranges::sort(rank, {}, [&](size_t k) { return stacking[k]; });
        for (size_t k = 0; k < rank.size(); k++)
            scene.shapes[rank[k]].depth = float(rank.size() - 1 - k);

        if (focusedHere || scene.focusedIndex < 0)
            state.focusFadeout.reset(); // a new focus, or the fadeout is over
        const uint64_t source = scene.focusedIndex >= 0 ? scene.shapes[scene.focusedIndex].id : 0;
        state.focusedWindow   = focusedHere;

        const Rect middle = {float(monitor->m_size.x * 0.3), float(monitor->m_size.y * 0.3), float(monitor->m_size.x * 0.4), float(monitor->m_size.y * 0.4)};
        const Rect target = scene.focusedIndex < 0 ? middle : scene.shapes[scene.focusedIndex].rect;

        // Focus moving to another window eases across; a focused window that
        // moves is followed exactly. Its presence is the window's own opacity,
        // fading with it after it closes; with nothing focused here (focus on
        // another screen, or the last window gone) it eases away.
        if (!state.seen) {
            state.seen       = true;
            state.focusFrom  = target;
            state.focusMoved = now - std::chrono::seconds(1);
        } else if (source != state.source) {
            state.focusFrom  = state.drawn.focus;
            state.alphaFrom  = state.drawn.focusAlpha;
            state.focusMoved = now;
        }
        state.source = source;

        const float k = easeOut(std::min(1.F, float(std::chrono::duration<double>(now - state.focusMoved).count() / FOCUS_EASE)));
        for (size_t i = 0; i < 4; i++)
            scene.focus[i] = state.focusFrom[i] + (target[i] - state.focusFrom[i]) * k;
        scene.focusAlpha = scene.focusedIndex >= 0 ? scene.shapes[scene.focusedIndex].alpha : state.alphaFrom * (1.F - k);
        const auto& area = monitor->m_reservedArea;
        scene.reserved   = {float(area.top()), float(area.right()), float(area.bottom()), float(area.left())};
        return scene;
    }

    float feedPresence(std::chrono::steady_clock::time_point now);

    // The impulse ring as it stands, after letting go of impulses that have
    // run out, voice, the agents' text and the world's clock.
    SAnswer readAnswer() {
        const auto now = std::chrono::steady_clock::now();
        while (!g->impulses.empty() && std::chrono::duration<double>(now - g->impulses.front().start).count() > IMPULSE_LIFE) {
            g->impulses.pop_front();
            g->impulseGeneration++;
        }
        // A window not drawn for ten seconds is closed or out of sight; it
        // starts still if it comes back.
        std::erase_if(g->motion, [&](const auto& entry) { return now - entry.second.seen > std::chrono::seconds(10); });
        const float presence = feedPresence(now);
        if (!answering()) {
            letGo();
            return {g->impulseGeneration, 0.F, presence, g->time};
        }
        const float voice = now - g->voiceReceived <= VOICE_STALE ? g->voice : 0.F;
        return {g->impulseGeneration, voice, presence, g->time};
    }

    bool covered(PHLMONITOR monitor) {
        return Fullscreen::controller()->getFullscreenModes(monitor).internal == Fullscreen::FSMODE_FULLSCREEN;
    }

    // Asks Hyprland to draw the whole monitor again in this frame, glass
    // included. Hyprland decides at render.pre, before the plugin's listener,
    // whether a frame blurs the glass again, and window motion never asks it
    // to, so the blur is queued here as well as made dirty; Hyprland still
    // runs it only with blur on (Hyprland 0.57.0 src/render/GLRenderer.cpp:388,
    // Renderer.cpp:967).
    void redraw(PHLMONITOR monitor) {
        g_pHyprRenderer->damageMonitor(monitor);
        monitor->m_blurFBDirty        = true;
        monitor->m_blurFBShouldRender = true;
        if (g)
            g->monitors[monitor->m_id].stale = true;
    }

    // How many levels the coarse world's mipmap has: as soft as the glass's
    // frost (Hyprland's blur size, which film.lua sets from the film's
    // frost): a blur of that size in two passes spreads a point over about
    // twice its size, in the monitor's pixels, of which the coarse world has
    // one in two.
    int frostLevels(const PHLMONITOR& monitor) {
        static auto SIZE = CConfigValue<Config::INTEGER>("decoration:blur:size");
        return std::clamp(int(std::round(std::log2(std::max(2.0 * *SIZE * monitor->m_scale, 1.0)))), 1, 6);
    }

    // Fills the texture bound on the active unit from `data`, with the
    // unpack state set plainly and put back after, since Hyprland's own
    // uploads rely on what they set.
    void upload(GLint format, GLsizei width, GLsizei height, GLenum layout, GLenum type, const void* data, GLint filter) {
        GLint unpackBuffer = 0, rowLength = 0, skipRows = 0, skipPixels = 0, alignment = 0;
        glGetIntegerv(GL_PIXEL_UNPACK_BUFFER_BINDING, &unpackBuffer);
        glGetIntegerv(GL_UNPACK_ROW_LENGTH, &rowLength);
        glGetIntegerv(GL_UNPACK_SKIP_ROWS, &skipRows);
        glGetIntegerv(GL_UNPACK_SKIP_PIXELS, &skipPixels);
        glGetIntegerv(GL_UNPACK_ALIGNMENT, &alignment);
        glBindBuffer(GL_PIXEL_UNPACK_BUFFER, 0);
        glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
        glPixelStorei(GL_UNPACK_SKIP_ROWS, 0);
        glPixelStorei(GL_UNPACK_SKIP_PIXELS, 0);
        glPixelStorei(GL_UNPACK_ALIGNMENT, 1);

        glTexImage2D(GL_TEXTURE_2D, 0, format, width, height, 0, layout, type, data);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, filter);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, filter);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

        glBindBuffer(GL_PIXEL_UNPACK_BUFFER, unpackBuffer);
        glPixelStorei(GL_UNPACK_ROW_LENGTH, rowLength);
        glPixelStorei(GL_UNPACK_SKIP_ROWS, skipRows);
        glPixelStorei(GL_UNPACK_SKIP_PIXELS, skipPixels);
        glPixelStorei(GL_UNPACK_ALIGNMENT, alignment);
    }

    // Fills the windows' uniform buffer, bound, with the shapes, three vec4s
    // each: (x, y, w, h), (alpha, rounding, lift, depth) and (velocity x, y);
    // the whole block, as a draw reads all of it.
    void uploadShapes(const std::vector<SShape>& shapes) {
        std::vector<float> data(WINDOWS_MAX * 12, 0.F);
        for (size_t i = 0; i < shapes.size(); i++) {
            const auto at = data.begin() + i * 12;
            std::copy(shapes[i].rect.begin(), shapes[i].rect.end(), at);
            at[4] = shapes[i].alpha;
            at[5] = shapes[i].rounding;
            at[6] = shapes[i].lift;
            at[7] = shapes[i].depth;
            at[8] = shapes[i].velocity[0];
            at[9]  = shapes[i].velocity[1];
        }
        glBufferData(GL_UNIFORM_BUFFER, data.size() * sizeof(float), data.data(), GL_STREAM_DRAW);
    }

    // Takes the newest valid snapshot waiting on the feed socket, at most
    // FEED_BUDGET datagrams a wakeup, never waiting: a truncated, oversized or
    // malformed one is dropped, and any valid one, a repeat too, says the
    // feed is alive.
    // A voice reading: the loudness now (whether speech is on, which the
    // feed also sends, no film answers).
    void onVoice(const uint8_t* data) {
        float level = 0;
        std::memcpy(&level, data, 4);
        if (!std::isfinite(level))
            return;
        g->voice         = answering() ? std::clamp(level, 0.F, 1.F) : 0.F;
        g->voiceReceived = std::chrono::steady_clock::now();
    }

    void wake();

    // What the feed says now, as the world hears it: voice until it is
    // VOICE_STALE old, and whether there is text until the feed is
    // FEED_STALE quiet. When that changes the world is drawn again, so voice
    // and text answer, and ease away when they run out, though the desktop
    // holds still; the timer waits for the next of them to run out.
    void heard() {
        const auto now   = std::chrono::steady_clock::now();
        const bool voice = g->voice > 0 && now - g->voiceReceived <= VOICE_STALE;
        feedPresence(now);
        const std::pair<float, bool> heard{voice ? g->voice : 0.F, g->presenceTarget};
        if (heard != g->heard)
            wake();
        g->heard  = heard;
        auto ends = std::chrono::steady_clock::time_point::max();
        if (voice)
            ends = g->voiceReceived + VOICE_STALE;
        if (g->presenceTarget)
            ends = std::min(ends, g->feedReceived + FEED_STALE);
        // Each end is still to come (`voice`, and feedPresence()'s own
        // staleness), so the wait is at least a millisecond; 0 disarms.
        const auto ms = ends == std::chrono::steady_clock::time_point::max() ? 0 : std::chrono::ceil<std::chrono::milliseconds>(ends - now).count() + 1;
        wl_event_source_timer_update(g->stale, int(ms));
    }

    int onStale(void*) {
        if (g)
            heard();
        return 0;
    }

    int onFeed(int fd, uint32_t, void*) {
        if (!g)
            return 0;
        std::array<uint8_t, FEED_HEADER + FEED_RING> buffer;
        for (int i = 0; i < FEED_BUDGET; i++) {
            const ssize_t length = recv(fd, buffer.data(), buffer.size(), MSG_DONTWAIT | MSG_TRUNC);
            if (length < 0)
                break;
            if (size_t(length) == VOICE_SIZE && std::memcmp(buffer.data(), "CVO1", 4) == 0) {
                onVoice(buffer.data() + 4);
                continue;
            }
            if (size_t(length) != buffer.size() || std::memcmp(buffer.data(), "CFD1", 4) != 0)
                continue;
            uint64_t generation = 0;
            uint32_t count = 0, pos = 0;
            std::memcpy(&generation, buffer.data() + 4, 8);
            std::memcpy(&count, buffer.data() + 12, 4);
            std::memcpy(&pos, buffer.data() + 16, 4);
            if (count > FEED_RING || pos >= FEED_RING)
                continue;
            // Every valid snapshot is the feed's whole state: a restarted feed
            // repeats generations, so only the content says whether it changed.
            g->feedReceived = std::chrono::steady_clock::now();
            g->feedEmpty    = count == 0;
            if (count == 0)
                continue; // the last text stays, for the backdrop to let it drain away
            if (count == g->feedCount && pos == g->feedPos && std::equal(buffer.begin() + FEED_HEADER, buffer.end(), g->feedRing.begin()))
                continue;
            std::copy(buffer.begin() + FEED_HEADER, buffer.end(), g->feedRing.begin());
            g->feedGeneration = generation;
            g->feedCount      = count;
            g->feedPos        = pos;
            g->feedChanges++;
        }
        heard();
        return 0;
    }

    // The socket the feed sends to, private to the user; without a runtime
    // directory or a socket there is simply no text. One Hyprland at a time
    // owns its path, the one holding feed.lock for as long as it runs: it
    // alone replaces a stale socket and removes it at exit, so a second
    // Hyprland in the session (a nested test) neither takes the feed nor
    // deletes the first one's socket.
    void openFeed() {
        const char* runtime = getenv("XDG_RUNTIME_DIR");
        if (!runtime || !*runtime)
            return;
        const std::string dir = std::string(runtime) + "/omarchy-cinema";
        mkdir(dir.c_str(), 0700);
        const int lock = open((dir + "/feed.lock").c_str(), O_RDWR | O_CREAT | O_CLOEXEC, 0600);
        if (lock < 0)
            return;
        if (flock(lock, LOCK_EX | LOCK_NB) != 0) {
            close(lock);
            return;
        }
        g->feedLock = lock;
        sockaddr_un address{};
        address.sun_family = AF_UNIX;
        const auto path    = dir + "/feed.sock";
        if (path.size() >= sizeof(address.sun_path))
            return;
        std::memcpy(address.sun_path, path.c_str(), path.size() + 1);
        const int fd = socket(AF_UNIX, SOCK_DGRAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
        if (fd < 0)
            return;
        unlink(path.c_str());
        if (bind(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0) {
            close(fd);
            return;
        }
        chmod(path.c_str(), 0600);
        g->feedFd     = fd;
        g->feedPath   = path;
        g->feedSource = wl_event_loop_add_fd(g_pCompositor->m_wlEventLoop, fd, WL_EVENT_READABLE, onFeed, nullptr);
        g->stale      = wl_event_loop_add_timer(g_pCompositor->m_wlEventLoop, onStale, nullptr);
    }

    void closeFeed() {
        for (const auto source : {g->feedSource, g->stale})
            if (source)
                wl_event_source_remove(source);
        if (g->feedFd >= 0) {
            close(g->feedFd);
            unlink(g->feedPath.c_str());
        }
        if (g->feedLock >= 0)
            close(g->feedLock);
    }

    // Glass: in a film theme, a window's background (the theme's background
    // colour) turns to glass, and everything drawn over it (text, icons, lines,
    // logos) keeps its full opacity.
    //
    // Hyprland fades a whole window by its opacity, text included, so the glass
    // is drawn where Hyprland draws windows: its own surface shader, the
    // version in this very build, with one step added after the window's pixel
    // is read: a pixel in one of the theme's background colours (background,
    // dark, darker, lighter) becomes glass at the theme's glass, and every
    // other pixel keeps exactly the opacity the app drew it with. An earlier
    // colour-to-alpha un-mixing made grey text partly see-through. It runs only in the shader's
    // blur variant (film.lua turns render:use_shader_blur_blend on), which
    // Hyprland uses only for windows it blurs: a solid browser, video or photo
    // is never touched. Hyprland reads shaders from a directory before its
    // built-in ones, so the patched shader is written to one of the plugin's
    // and loaded with reloadShaders; Hyprland's own come back when the theme
    // has no backdrop or the plugin unloads.
    std::string glassShaderSource() {
        const auto glass = g->glass;
        if (g->source.empty() || glass >= 1.F || g->backgrounds.empty())
            return "";
        const auto found = std::ranges::find(SHADERS, std::string_view{"surface.frag"}, [](const auto& pair) { return pair.first; });
        if (found == SHADERS.end())
            return "";
        std::string source{found->second};
        const std::string output = "layout(location = 0) out vec4 fragColor;";
        const std::string read   = "#if USE_DISCARD && !USE_BLUR";
        const std::string frost  = "pixColor += blurredPixColor * pixBlurBgAlpha;";
        const auto        at     = source.find(output);
        if (at == std::string::npos || source.find(output, at + 1) != std::string::npos || source.find(read) == std::string::npos ||
            source.find(frost) == std::string::npos) {
            HyprlandAPI::addNotification(g->handle, "[backdrop] this Hyprland's window shader has changed shape; windows stay solid", CHyprColor{1.0, 0.6, 0.2, 1.0}, 10000);
            return "";
        }
        const auto vec3 = [](const std::array<float, 3>& c) { return std::format("vec3({:.6f}, {:.6f}, {:.6f})", c[0], c[1], c[2]); };
        std::string keys;
        for (const auto& c : g->backgrounds)
            keys += (keys.empty() ? "" : ", ") + vec3(c);
        source.insert(at, std::format(R"(// omarchy-cinema glass: see the backdrop plugin.
const vec3  CINEMA_BACKGROUNDS[{}] = vec3[]({});
const float CINEMA_GLASS = {:.4f};
const vec3  CINEMA_BACKGROUND = {}, CINEMA_MUTED = {};
vec3 cinemaLinear(vec3 c) {{
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}}
float cinemaLuminance(vec3 c) {{
    return dot(cinemaLinear(c), vec3(0.2126, 0.7152, 0.0722));
}}
// The theme's background shade nearest a colour (rgb), and how far off it is
// (w, its largest channel's difference).
vec4 cinemaShade(vec3 rgb) {{
    vec4 nearest = vec4(CINEMA_BACKGROUND, 1.0);
    for (int i = 0; i < {}; i++) {{
        vec3  e   = abs(rgb - CINEMA_BACKGROUNDS[i]);
        float off = max(max(e.r, e.g), e.b);
        if (off < nearest.w) nearest = vec4(CINEMA_BACKGROUNDS[i], off);
    }}
    return nearest;
}}
// A pixel composited over the frost (pix plus k of frost), held so that
// muted text keeps 4.5:1 (WCAG) on it: one past that, as the display shows
// it in whole 8-bit levels, moves in linear light toward its background
// shade drawn solid (a pixel of anything else, toward itself with the
// theme's background in place of the frost), dimming in its own hue on a dark theme, until it meets
// 4.5:1 on a whole level. Where that shade, drawn solid, is itself short of
// 4.5:1, it goes as far as the shade: the glass never reads worse than the
// theme drawn solid. Text drawn opaque has no frost to hold.
#if USE_BLUR
vec4 cinemaHold(vec4 pix, vec2 uv, float k) {{
    if (k <= 0.0) return pix;
    vec4  c     = pix + texture(blurredBG, uv) * k;
    float m     = cinemaLuminance(CINEMA_MUTED), side = sign(m - cinemaLuminance(CINEMA_BACKGROUND));
    float limit = side > 0.0 ? (m + 0.05) / 4.5 - 0.05 : 4.5 * (m + 0.05) - 0.05;
    vec3  shown = round(c.rgb * 255.0) / 255.0;
    // A pixel with no frost in it, or every channel of it on the safe side of
    // the grey that is exactly at the limit, is within it: most of the glass,
    // and all of a layer's empty pixels, stop here.
    float grey  = 1.055 * pow(max(limit, 0.0), 1.0 / 2.4) - 0.055;
    if ((side > 0.0 ? max(max(shown.r, shown.g), shown.b) <= grey : min(min(shown.r, shown.g), shown.b) >= grey)) return c;
    float y     = cinemaLuminance(shown);
    if ((y - limit) * side <= 0.0) return c;
    vec4  own  = cinemaShade(pix.a > 0.0 ? pix.rgb / pix.a : CINEMA_BACKGROUND);
    vec3  safe = own.w <= 2.5 / 255.0 ? own.rgb * (pix.a + k) : pix.rgb + CINEMA_BACKGROUND * k;
    float s    = cinemaLuminance(safe);
    vec3  held = mix(cinemaLinear(safe), cinemaLinear(shown), (s - limit) * side < 0.0 ? (limit - s) / (y - s) : 0.0);
    held       = mix(held * 12.92, 1.055 * pow(held, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, held)) * 255.0;
    return vec4((side > 0.0 ? floor(held) : ceil(held)) / 255.0, c.a);
}}
#endif
vec4 cinemaGlass(vec4 c) {{
    // Nothing to judge where the app drew nothing.
    if (c.a <= 0.0) return c;
    // Judged by colour alone, before the app's own alpha: a terminal that
    // draws its background half see-through gets the same glass as a window
    // that draws it solid.
    vec3  rgb = c.rgb / c.a;
    // Only a background colour itself is background, within a step or two of
    // rounding. Panels, cards, fields, rows and dividers are shaded a few
    // steps off it, and they are interface, not background: they keep their
    // opacity with the text, icons and lines.
    float background = 1.0 - smoothstep(0.5 / 255.0, 2.5 / 255.0, cinemaShade(rgb).w);
    float a = mix(c.a, CINEMA_GLASS, background);
    return vec4(rgb * a, a);
}}

)",
                                         g->backgrounds.size(), keys, glass, vec3(g->background), vec3(g->muted), g->backgrounds.size()));
        source.insert(source.find(read), "#if USE_BLUR\n    pixColor = cinemaGlass(pixColor);\n#endif\n\n");
        // The frost is held where Hyprland composites it, for the window's
        // pixel and, when it mirrors, the mirror's.
        static const std::regex COMPOSITE(R"((pixColor|mirrorColor) \+= (blurred\w+) \* (\w+);)");
        source = std::regex_replace(source, COMPOSITE, "$1 = cinemaHold($1, blurUV, $3);");
        return source;
    }

    std::string glassDir() {
        const char* runtime = getenv("XDG_RUNTIME_DIR");
        return std::string(runtime && *runtime ? runtime : "/tmp") + "/omarchy-cinema/shaders";
    }

    // Loads the glass shader the theme asks for, or Hyprland's own, when that
    // changed. Hyprland's hyprctl reloadshaders does the same from its loop.
    void applyGlass() {
        const auto wanted = glassShaderSource();
        if (wanted == g->glassShader)
            return;
        if (!wanted.empty()) {
            std::filesystem::create_directories(glassDir());
            std::ofstream(glassDir() + "/surface.frag") << wanted;
        }
        if (g_pHyprRenderer->reloadShaders(wanted.empty() ? "" : glassDir()))
            g->glassShader = wanted;
    }

    // How present the agents' text is now: easing toward whether there is any,
    // read against the clock, so it takes FEED_EASE at any frame rate.
    float feedPresence(std::chrono::steady_clock::time_point now) {
        const bool live     = g->feedFd >= 0 && now - g->feedReceived <= FEED_STALE;
        const bool text     = !g->glyphPixels.empty() && live && !g->feedEmpty && g->feedCount > 0;
        const auto presence = [&] {
            const float moved = std::chrono::duration<float>(now - g->presenceChanged).count() / FEED_EASE;
            return std::clamp(g->presenceFrom + (g->presenceTarget ? moved : -moved), 0.F, 1.F);
        };
        if (text != g->presenceTarget) {
            g->presenceFrom    = presence();
            g->presenceChanged = now;
            g->presenceTarget  = text;
        }
        return presence();
    }

    // Everything the contract gives a film, for program `p`, drawing `area`
    // (logical px) placed by `proj` on `monitor`, at `now`. The textures are
    // on units 4 to 6: the world drawn at half size, the lettering and the
    // feed; the windows are uniform block 0.
    void setUniforms(const SProgram& p, const PHLMONITOR& monitor, const SScene& scene, const SAnswer& answer, const Mat3x3& proj, const CBox& area,
                     std::chrono::steady_clock::time_point now) {
        const auto& gpu  = g->gpu;
        const auto& kept = g->gpu.coarse[monitor->m_id];
        glUseProgram(p.id);
        glUniformMatrix3fv(p.proj, 1, GL_TRUE, proj.getMatrix().data());
        glUniform4f(p.area, area.x, area.y, area.w, area.h);
        glUniform2f(p.resolution, monitor->m_size.x, monitor->m_size.y);
        glUniform1f(p.time, answer.time);
        glUniform3fv(p.accent, 1, g->accent.data());
        glUniform3fv(p.background, 1, g->background.data());
        glUniform3fv(p.foreground, 1, g->foreground.data());
        glUniform4fv(p.focused, 1, scene.focus.data());
        glUniform4fv(p.reserved, 1, scene.reserved.data());
        glUniform1i(p.drawnWorld, 4);
        glUniformMatrix3fv(p.worldProj, 1, GL_TRUE, kept.proj.getMatrix().data());
        glUniform1i(p.windowCount, scene.shapes.size());
        glUniform1i(p.focusedIndex, scene.focusedIndex);
        glUniform1f(p.focusAlpha, scene.focusAlpha);
        glUniform1i(p.glyphsUniform, 5);
        glUniform1i(p.feedUniform, 6);
        glUniform1i(p.feedCount, gpu.glyphsUploaded && answer.presence > 0 && kept.feedUploaded ? int(kept.feedCount) : 0);
        glUniform1i(p.feedPos, int(kept.feedPos));
        glUniform1f(p.feedPresence, answer.presence);
        glUniform1f(p.voice, answer.voice);
        // The impulses with their ages now, on this monitor's coordinates:
        // ages from the monotonic clock, so the hourly wrap of `time` never
        // reaches them. Each names its window by its place in this scene.
        std::array<float, 4 * IMPULSES> impulses{};
        std::array<int, IMPULSES>       kinds{}, windows{};
        int                             count = 0;
        for (const auto& impulse : g->impulses) {
            const auto found        = impulse.window ? std::ranges::find(scene.shapes, impulse.window, &SShape::id) : scene.shapes.end();
            windows[count]          = found == scene.shapes.end() ? -1 : int(found - scene.shapes.begin());
            const auto at           = impulse.at - monitor->m_position;
            impulses[4 * count + 0] = float(at.x);
            impulses[4 * count + 1] = float(at.y);
            impulses[4 * count + 2] = std::chrono::duration<float>(now - impulse.start).count();
            impulses[4 * count + 3] = impulse.strength;
            kinds[count++]          = impulse.kind;
        }
        glUniform4fv(p.impulses, IMPULSES, impulses.data());
        glUniform1iv(p.impulseKinds, IMPULSES, kinds.data());
        glUniform1iv(p.impulseWindows, IMPULSES, windows.data());
        glUniform1i(p.impulseCount, count);
    }

    // A pass is a guest in Hyprland's GL context. Hyprland skips binding a
    // program or texture unit it believes is still current, so a pass holds
    // one of these from its first GL call to its last, uploads included, and
    // leaves all it changes as it found it: the program, the vertex array,
    // the textures on the films' units 4 to 6, the active unit and the
    // uniform buffer bindings.
    struct SGuest {
        GLint                program = 0, vao = 0, unit = 0, uniforms = 0, block = 0;
        std::array<GLint, 3> textures{};
        SGuest() {
            glGetIntegerv(GL_CURRENT_PROGRAM, &program);
            glGetIntegerv(GL_VERTEX_ARRAY_BINDING, &vao);
            glGetIntegerv(GL_ACTIVE_TEXTURE, &unit);
            glGetIntegerv(GL_UNIFORM_BUFFER_BINDING, &uniforms);
            glGetIntegeri_v(GL_UNIFORM_BUFFER_BINDING, 0, &block);
            for (int i = 0; i < 3; i++) {
                glActiveTexture(GL_TEXTURE4 + i);
                glGetIntegerv(GL_TEXTURE_BINDING_2D, &textures[i]);
            }
        }
        ~SGuest() {
            glBindVertexArray(vao);
            glUseProgram(program);
            glBindBufferBase(GL_UNIFORM_BUFFER, 0, block);
            glBindBuffer(GL_UNIFORM_BUFFER, uniforms);
            for (int i = 0; i < 3; i++) {
                glActiveTexture(GL_TEXTURE4 + i);
                glBindTexture(GL_TEXTURE_2D, textures[i]);
            }
            glActiveTexture(unit);
        }
    };

    // Binds the film's textures, with the kept world's text, and its world
    // drawn at half size unless that is being drawn (`drawing`), and the
    // windows, sets the program's state with `set` and binds the square.
    void prepare(const SCoarse& kept, bool drawing, const std::function<void()>& set) {
        auto& gpu = g->gpu;
        for (int unit = 0; unit < 3; unit++) {
            glActiveTexture(GL_TEXTURE4 + unit);
            glBindTexture(GL_TEXTURE_2D, std::array{drawing ? 0 : kept.texture, gpu.glyphs, kept.feed}[unit]);
        }
        glBindBufferBase(GL_UNIFORM_BUFFER, 0, gpu.windows);
        set();
        glBindVertexArray(gpu.vao);
    }

    // Draws the square over each rect of `where`, a part of the damage.
    void drawSquare(Render::CRenderContext& ctx, const SCoarse& kept, const CRegion& where, const std::function<void()>& set) {
        prepare(kept, false, set);
        where.forEachRect([&ctx](const auto& rect) {
            g_pHyprOpenGL->scissor(ctx, &rect, ctx.m_data.transformDamage);
            glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        });
        g_pHyprOpenGL->disableScissor();
    }

    // The glass's frost: the coarse world softened through its mipmap, its
    // last level as soft as the film's frost, copied into the framebuffer
    // Hyprland's glass reads, so Hyprland need not blur the screen itself.
    void frost(PHLMONITOR monitor, SCoarse& coarse) {
        const auto resources = monitor->resources();
        auto*      target    = resources ? dynamic_cast<Render::GL::CGLFramebuffer*>(resources->m_blurFB.get()) : nullptr;
        if (!target || !target->isAllocated())
            return;
        coarse.frosted     = target->getFBID();
        coarse.frostedSize = target->m_size;
        GLint draw = 0;
        glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &draw);
        std::array<GLint, 4> viewport{};
        glGetIntegerv(GL_VIEWPORT, viewport.data());
        auto& gpu = g->gpu;
        glActiveTexture(GL_TEXTURE4);
        glBindTexture(GL_TEXTURE_2D, coarse.texture);
        glGenerateMipmap(GL_TEXTURE_2D);
        glBindFramebuffer(GL_DRAW_FRAMEBUFFER, target->getFBID());
        glViewport(0, 0, target->m_size.x, target->m_size.y);
        g_pHyprOpenGL->disableScissor();
        glUseProgram(gpu.copy);
        const Mat3x3 whole(std::array<float, 9>{2, 0, -1, 0, 2, -1, 0, 0, 1});
        glUniformMatrix3fv(gpu.copyProj, 1, GL_TRUE, whole.getMatrix().data());
        glUniform4f(gpu.copyArea, 0, 0, 1, 1);
        glUniform1i(gpu.copySource, 4);
        glUniform1f(gpu.copyLevel, float(coarse.levels - 1));
        glUniform2f(gpu.copySize, target->m_size.x, target->m_size.y);
        glBindVertexArray(gpu.vao);
        glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        glViewport(viewport[0], viewport[1], viewport[2], viewport[3]);
        glBindFramebuffer(GL_DRAW_FRAMEBUFFER, draw);
    }

    // What the plugin's passes share: they read no blur of Hyprland's, and
    // they are drawn as Hyprland draws any custom element.
    class CPass : public IPassElement {
      public:
        bool needsLiveBlur(Render::CRenderContext&) override {
            return false;
        }
        bool needsPrecomputeBlur(Render::CRenderContext&) override {
            return false;
        }
        ePassElementType type() override {
            return EK_CUSTOM;
        }
        static std::optional<CBox> screen(const PHLMONITORREF& ref) {
            const auto monitor = ref.lock();
            return monitor ? std::optional<CBox>(CBox{0, 0, monitor->m_size.x, monitor->m_size.y}) : std::nullopt;
        }
    };

    class CBackdropPass : public CPass {
      public:
        CBackdropPass(PHLMONITOR monitor, SScene scene, SAnswer answer) : m_monitor(monitor), m_scene(std::move(scene)), m_answer(answer) {}

        std::vector<UP<IPassElement>> draw(Render::CRenderContext& ctx) override {
            const auto monitor = m_monitor.lock();
            if (!monitor)
                return {};
            // The textures for this frame, filled here, where the render
            // context is current; every frame drawn after reads them.
            const SGuest guest;
            auto&        gpu = g->gpu;
            glBindBuffer(GL_UNIFORM_BUFFER, gpu.windows);
            uploadShapes(m_scene.shapes);
            // The half-size world and the frost are kept, and drawn again
            // only when the world changed, or for a new size or frost target.
            auto&      state     = g->monitors[monitor->m_id];
            auto&      coarse    = gpu.coarse[monitor->m_id];
            const int  width = (monitor->m_transformedSize.x + 1) / 2, height = (monitor->m_transformedSize.y + 1) / 2;
            const int  levels    = frostLevels(monitor);
            const auto resources = monitor->resources();
            auto*      target    = resources ? dynamic_cast<Render::GL::CGLFramebuffer*>(resources->m_blurFB.get()) : nullptr;
            const bool resized   = coarse.width != width || coarse.height != height || coarse.levels != levels;
            const bool whole     = resized || state.stale || !target || target->getFBID() != coarse.frosted || target->m_size != coarse.frostedSize;
            state.stale          = false;
            if (!g->glyphPixels.empty()) {
                glActiveTexture(GL_TEXTURE5);
                glBindTexture(GL_TEXTURE_2D, gpu.glyphs);
                if (!gpu.glyphsUploaded) {
                    upload(GL_R8, g->glyphWidth, g->glyphHeight, GL_RED, GL_UNSIGNED_BYTE, g->glyphPixels.data(), GL_LINEAR);
                    gpu.glyphsUploaded = true;
                }
                if (whole && coarse.feedUploaded != g->feedChanges) {
                    if (!coarse.feed)
                        glGenTextures(1, &coarse.feed);
                    glActiveTexture(GL_TEXTURE6);
                    glBindTexture(GL_TEXTURE_2D, coarse.feed);
                    upload(GL_R8, 128, FEED_RING / 128, GL_RED, GL_UNSIGNED_BYTE, g->feedRing.data(), GL_NEAREST);
                    coarse.feedUploaded = g->feedChanges;
                    coarse.feedCount    = g->feedCount;
                    coarse.feedPos      = g->feedPos;
                }
            }
            const auto now  = std::chrono::steady_clock::now();
            const auto proj = g_pHyprRenderer->projectBoxToTarget(ctx, CBox{0, 0, monitor->m_transformedSize.x, monitor->m_transformedSize.y});
            const auto set  = [&] { setUniforms(gpu.backdrop, monitor, m_scene, m_answer, proj, CBox{0, 0, monitor->m_size.x, monitor->m_size.y}, now); };
            if (resized) {
                if (coarse.fbo) {
                    glDeleteTextures(1, &coarse.texture);
                    glDeleteFramebuffers(1, &coarse.fbo);
                }
                glGenTextures(1, &coarse.texture);
                glGenFramebuffers(1, &coarse.fbo);
                glActiveTexture(GL_TEXTURE4);
                glBindTexture(GL_TEXTURE_2D, coarse.texture);
                glTexStorage2D(GL_TEXTURE_2D, levels, GL_RGB10_A2, width, height);
                // Its levels for the frost, level 0 for the frames (worldAt()).
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_NEAREST);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
                coarse.width  = width;
                coarse.height = height;
                coarse.levels = levels;
            }
            // The world at half the monitor's size over all of it, on the
            // same projection, softened into the glass's frost (frost()).
            if (whole) {
                GLint draw = 0, read = 0;
                glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &draw);
                glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING, &read);
                std::array<GLint, 4> viewport{};
                glGetIntegerv(GL_VIEWPORT, viewport.data());
                glBindFramebuffer(GL_FRAMEBUFFER, coarse.fbo);
                glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, coarse.texture, 0);
                glViewport(0, 0, width, height);
                coarse.proj = proj;
                prepare(coarse, true, set);
                g_pHyprOpenGL->disableScissor();
                glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
                glBindFramebuffer(GL_DRAW_FRAMEBUFFER, draw);
                glBindFramebuffer(GL_READ_FRAMEBUFFER, read);
                glViewport(viewport[0], viewport[1], viewport[2], viewport[3]);
                frost(monitor, coarse);
            }
            // At full size over the damage Hyprland leaves it: all of it but
            // what frosted windows cover (CGlassPass). Not kept between
            // frames: Hyprland draws its last two frames' damage again too,
            // merged into few boxes, and a copy over that cost about as much
            // as drawing it (specs/smoothness.md, "Frame budget").
            drawSquare(ctx, coarse, ctx.m_data.damage, set);
            return {};
        }

        const char* passName() override {
            return "CBackdropPass";
        }
        // It makes the glass's frost, which Hyprland no longer does, so it
        // runs even when windows hide all of it.
        bool undiscardable(Render::CRenderContext&) override {
            return true;
        }
        // The backdrop covers the whole monitor, so Hyprland can skip drawing
        // the wallpaper under it.
        std::optional<CBox> boundingBox(Render::CRenderContext&) override {
            return screen(m_monitor);
        }
        CRegion opaqueRegion(Render::CRenderContext& ctx) override {
            const auto box = boundingBox(ctx);
            return box ? CRegion(*box) : CRegion{};
        }

      private:
        PHLMONITORREF m_monitor;
        SScene        m_scene;
        SAnswer       m_answer;
    };

    // A frosted window's glass, as Hyprland's own occlusion sees it: drawn
    // in the window's pass just under its surface, it says that what is under
    // the glass (all of it but its rounded corners and the pixel round its
    // edge) will be covered opaque, so Hyprland leaves it out of the damage of
    // everything drawn before, as it leaves out what any opaque surface
    // covers: the backdrop, the window's own shadow, the windows beneath. A
    // live blur reads the screen under it, and Hyprland draws what is under
    // the glass wherever one will (Hyprland 0.57.0 src/render/pass/Pass.cpp:85).
    // It draws nothing itself.
    class CGlassPass : public CPass {
      public:
        CGlassPass(PHLMONITOR monitor, const CBox& glass) : m_monitor(monitor), m_glass(glass) {}

        const char* passName() override {
            return "CGlassPass";
        }
        // Hyprland weighs an element's opaque region only when it has a box.
        std::optional<CBox> boundingBox(Render::CRenderContext&) override {
            return screen(m_monitor);
        }
        CRegion opaqueRegion(Render::CRenderContext&) override {
            return m_glass;
        }

      private:
        PHLMONITORREF m_monitor;
        CRegion       m_glass;
    };

    // A window's edge in the film's world (specs/depth.md, part 2): the
    // film's frame(px, i) over a band round the window, drawn in the window's
    // own pass, so it moves, tilts and fades with it. It reads the scene and
    // textures the backdrop drew this frame.
    class CFramePass : public CPass {
      public:
        CFramePass(PHLMONITOR monitor, uint64_t window, float alpha, float border) : m_monitor(monitor), m_window(window), m_alpha(alpha), m_border(border) {}

        std::vector<UP<IPassElement>> draw(Render::CRenderContext& ctx) override {
            const auto monitor = m_monitor.lock();
            if (!monitor || !g || !g->gpu.frame.id)
                return {};
            auto&      state  = g->monitors[monitor->m_id];
            const auto shapes = state.drawn.shapes;
            const auto found  = std::ranges::find(shapes, m_window, &SShape::id);
            if (found == shapes.end())
                return {};
            const int  index = found - shapes.begin();
            const CBox area  = band(*found);
            const auto onTarget = [&](CBox logical) {
                ctx.m_data.renderModif.applyToBox(logical.scale(monitor->m_scale));
                return logical;
            };
            // A frame draws nothing over 2 px inside its window (contract.glsl),
            // so the pixels wholly inside that are left out, as Hyprland's
            // border leaves out the window's inside; CRegion would truncate a
            // box's origin and size apart, so the pixels are counted here.
            const CBox   inside = onTarget(CBox{found->rect[0], found->rect[1], found->rect[2], found->rect[3]}.expand(-found->rounding - 3.0));
            const double left = std::ceil(inside.x), top = std::ceil(inside.y);
            const CRegion within(left, top, std::max(std::floor(inside.x + inside.w) - left, 0.0), std::max(std::floor(inside.y + inside.h) - top, 0.0));
            const auto   proj   = g_pHyprRenderer->projectBoxToTarget(ctx, onTarget(area));
            const auto   now    = std::chrono::steady_clock::now();
            const SGuest guest;
            g_pHyprRenderer->blend(true);
            drawSquare(ctx, g->gpu.coarse[monitor->m_id], ctx.m_data.damage.copy().subtract(within), [&] {
                setUniforms(g->gpu.frame, monitor, state.drawn, state.answered, proj, area, now);
                glUniform1i(g->gpu.frame.frameWindow, index);
                glUniform1f(g->gpu.frame.frameAlpha, m_alpha);
                glUniform1f(g->gpu.frame.frameBorder, m_border);
            });
            return {};
        }

        const char* passName() override {
            return "CFramePass";
        }
        std::optional<CBox> boundingBox(Render::CRenderContext&) override {
            const auto monitor = m_monitor.lock();
            if (!monitor || !g)
                return std::nullopt;
            const auto& shapes = g->monitors[monitor->m_id].drawn.shapes;
            const auto  found  = std::ranges::find(shapes, m_window, &SShape::id);
            return found == shapes.end() ? std::nullopt : std::optional<CBox>(band(*found));
        }

      private:
        static CBox band(const SShape& shape) {
            return CBox{shape.rect[0], shape.rect[1], shape.rect[2], shape.rect[3]}.expand(FRAME_BAND);
        }

        PHLMONITORREF m_monitor;
        uint64_t      m_window;
        float         m_alpha;
        float         m_border;
    };

    // The film's part of every window, drawn in the window's own pass and
    // taking no room and no input: at DECORATION_LAYER_UNDER, under its
    // surface and after its shadow, the glass that a frosted window makes
    // opaque (CGlassPass); at DECORATION_LAYER_OVER, above it and below its
    // popups, its frame (CFramePass). Neither is drawn in a workspace drawn
    // on its own (a capture or snapshot): its scene is not the monitor's,
    // and the backdrop is not drawn there.
    class CFilmDecoration : public IHyprWindowDecoration {
      public:
        CFilmDecoration(PHLWINDOW window, eDecorationLayer layer) : IHyprWindowDecoration(window), m_layer(layer) {}

        SDecorationPositioningInfo getPositioningInfo() override {
            SDecorationPositioningInfo info;
            info.policy         = DECORATION_POSITION_ABSOLUTE;
            info.desiredExtents = {{FRAME_BAND, FRAME_BAND}, {FRAME_BAND, FRAME_BAND}};
            info.edges          = DECORATION_EDGE_BOTTOM | DECORATION_EDGE_LEFT | DECORATION_EDGE_RIGHT | DECORATION_EDGE_TOP;
            return info;
        }
        void onPositioningReply(const SDecorationPositioningReply&) override {}
        void draw(Render::CRenderContext& ctx, PHLMONITOR monitor, float const& a, const Render::SWindowRenderPresentation& drawn) override {
            const auto window = owningWindow();
            if (!g || g->source.empty() || !window || ctx.readOnlyEffects())
                return;
            if (m_layer == DECORATION_LAYER_OVER && g->framed && g->depth->value() > 0)
                Render::IHyprRenderer::addPassElement(ctx, makeUnique<CFramePass>(monitor, window->metadata().stableID(), a, float(window->presentation().borderSize())));
            else if (m_layer == DECORATION_LAYER_UNDER && frosted(ctx, window, drawn)) {
                const auto [position, size] = drawnBox(window, drawn, monitor);
                Render::IHyprRenderer::addPassElement(ctx, makeUnique<CGlassPass>(monitor, CBox{position, size}.expand(-window->presentation().rounding() - 2.0)));
            }
        }
        eDecorationType getDecorationType() override {
            return DECORATION_CUSTOM;
        }
        void updateWindow(PHLWINDOW) override {}
        void damageEntire() override {
            if (const auto window = owningWindow())
                g_pHyprRenderer->damageBox(window->getFullWindowBoundingBox().expand(FRAME_BAND));
        }
        eDecorationLayer getDecorationLayer() override {
            return m_layer;
        }
        uint64_t getDecorationFlags() override {
            return DECORATION_NON_SOLID;
        }
        std::string getDisplayName() override {
            return m_layer == DECORATION_LAYER_OVER ? "cinema frame" : "cinema glass";
        }

      private:
        eDecorationLayer m_layer;
    };

    void decorate(const PHLWINDOW& window) {
        if (g && window)
            for (const auto layer : {DECORATION_LAYER_UNDER, DECORATION_LAYER_OVER})
                HyprlandAPI::addWindowDecoration(g->handle, window, makeShared<CFilmDecoration>(window, layer));
    }

    // While the world moves nowhere, time stands still: the clock forgets
    // when it last ran, and the next frame the world moves in starts it
    // again from where it stood.
    void standStill() {
        if (std::ranges::none_of(State::monitorState()->monitors(), moves)) {
            g->clocked = {};
            g->speed   = 0;
        }
    }

    // The world's clock run on to `now` (contract.glsl, `time`): its speed
    // eases toward 1 until STIR_HOLD after the scene last changed and
    // toward 0 after that, and time runs on at that speed, worked out exactly
    // from those moments alone, whatever frames came between. A change seen
    // in this frame (`stirred`) starts the next rise; a speed fallen below
    // STIR_STILL stops.
    void advance(bool stirred, std::chrono::steady_clock::time_point now) {
        const auto run = [](double target, double ease, double dt) {
            if (dt <= 0)
                return;
            const double k = std::exp(-dt / ease);
            g->time        = float(std::fmod(g->time + target * dt + (g->speed - target) * ease * (1.0 - k), 3600.0));
            g->speed       = target + (g->speed - target) * k;
        };
        const auto seconds = [](auto d) { return std::chrono::duration<double>(d).count(); };
        if (g->clocked != std::chrono::steady_clock::time_point{}) {
            const auto rose = g->stirred + std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::duration<double>(STIR_HOLD));
            const auto turn = std::clamp(rose, g->clocked, now);
            run(1.0, STIR_RISE, seconds(turn - g->clocked));
            run(0.0, STIR_FALL, seconds(now - turn));
        }
        g->clocked = now;
        if (stirred)
            g->stirred = now;
        else if (g->speed < STIR_STILL && seconds(now - g->stirred) >= STIR_HOLD)
            g->speed = 0;
    }

    // The world drawn again, whole, on every monitor it moves on.
    void wake() {
        if (g && !g->source.empty())
            for (const auto& monitor : State::monitorState()->monitors())
                if (moves(monitor))
                    redraw(monitor);
    }

    // Once Hyprland has finished a change that may move the glass or start
    // or stop the world (a theme read or config change; a lock or a monitor
    // leaving, both announced before Hyprland marks them; a window going
    // fullscreen; a monitor coming, sleeping or waking): the glass the theme
    // asks for; answers let go if the world no longer answers, so turning
    // depth or animations off and on again brings nothing back; and the
    // world drawn whole where it moves, and standing still where it does not.
    void settled(void*) {
        if (!g)
            return;
        g->settling = nullptr;
        applyGlass();
        if (!answering())
            letGo();
        wake();
        standStill();
    }

    void settle() {
        if (g && !g->settling)
            g->settling = wl_event_loop_add_idle(g_pCompositor->m_wlEventLoop, settled, nullptr);
    }

    // A frame shown asks for the next while the world goes on changing on
    // its own there: easing after a change, an answer alive, or its clock
    // running down. Otherwise nothing asks.
    void onPresented(const PHLMONITOR& monitor) {
        if (!g || g->source.empty())
            return;
        if (!moves(monitor))
            return standStill();
        if (g->monitors[monitor->m_id].changed || g->speed > 0)
            redraw(monitor);
    }

    void onPre(PHLMONITOR monitor) {
        if (!g || g->source.empty())
            return;
        auto& state   = g->monitors[monitor->m_id];
        state.pending = readScene(monitor, state);
        // The world's clock runs on while it moves here, each frame at its
        // render.pre, just after the vblank before the one it is shown at.
        const float before = g->time;
        if (moves(monitor))
            advance(state.pending != state.drawn, std::chrono::steady_clock::now());
        // The clock is every monitor's: when it runs, each is drawn again.
        if (g->time != before)
            wake();
        state.answer = readAnswer();
        // A change of the world changes it everywhere: all of it, the
        // half-size world and the frost too, is drawn again in this frame.
        state.changed = state.pending != state.drawn || state.answer != state.answered || !g->impulses.empty();
        if (state.changed)
            redraw(monitor);
    }

    // The backdrop is drawn in the monitor's own frames. A workspace captured
    // or snapshotted on its own draws in an isolated scene, without it, as
    // its windows there are not where the monitor's scene has them.
    void onStage(const Event::SRenderStageEvent& event) {
        if (!g || event.stage != RENDER_POST_WALLPAPER || g->source.empty() || !event.context || !event.monitor)
            return;
        auto& ctx = event.context->get();
        if (ctx.readOnlyEffects() || !program())
            return;
        // The backdrop makes the glass's frost itself (frost()), so Hyprland's
        // own blur of the screen is not queued after it.
        event.monitor->m_blurFBDirty = false;
        auto& state    = g->monitors[event.monitor->m_id];
        state.drawn    = state.pending;
        state.answered = state.answer;
        Render::IHyprRenderer::addPassElement(ctx, makeUnique<CBackdropPass>(event.monitor, state.pending, state.answer));
    }

} // namespace

APICALL EXPORT std::string PLUGIN_API_VERSION() {
    return HYPRLAND_API_VERSION;
}

APICALL EXPORT PLUGIN_DESCRIPTION_INFO PLUGIN_INIT(HANDLE handle) {
    if (__hyprland_api_get_hash() != std::string(__hyprland_api_get_client_hash())) {
        HyprlandAPI::addNotification(handle, "[backdrop] built for another Hyprland: after a Hyprland update, log in again; otherwise run omarchy-cinema/install", CHyprColor{1.0, 0.2, 0.2, 1.0}, 15000);
        throw std::runtime_error("[backdrop] version mismatch");
    }

    g         = makeUnique<SState>();
    g->handle = handle;
    g->depth      = makeShared<Config::Values::CIntValue>("plugin:backdrop:depth", "How far windows' depth goes: 0 the backdrop alone (no answers or frames), above 0 with them (specs/depth.md, \"Tiers\")", 2,
                                                         Config::Values::SIntValueOptions{.min = 0, .max = 3});
    HyprlandAPI::addConfigValueV2(handle, g->depth);
    openFeed();
    readTheme();
    claimFadeouts();

    static auto PRE      = Event::bus()->m_events.render.pre.listen([](PHLMONITOR monitor) { onPre(monitor); });
    static auto STAGE    = Event::bus()->m_events.render.stage.listen([](const Event::SRenderStageEvent& event) { onStage(event); });
    static auto CLOSE    = Event::bus()->m_events.window.close.listen([](PHLWINDOW window) {
        if (!g)
            return;
        windowImpulse(window, Desktop::View::IGeometric::GEOMETRIC_CURRENT, 1.F, IMPULSE_CLOSE);
        claimFadeouts();
        g->closing = window;
    });
    static auto OPEN = Event::bus()->m_events.window.open.listen([](PHLWINDOW window) {
        decorate(window);
        windowImpulse(window, Desktop::View::IGeometric::GEOMETRIC_GOAL, 1.F, IMPULSE_OPEN);
    });
    for (const auto& window : Desktop::windowState()->windows())
        decorate(window);
    static auto ACTIVE = Event::bus()->m_events.window.active.listen(
        [](PHLWINDOW window, Desktop::eFocusReason) { windowImpulse(window, Desktop::View::IGeometric::GEOMETRIC_CURRENT, 0.6F, IMPULSE_FOCUS); });
    static auto RELOADED = Event::bus()->m_events.config.reloaded.listen([] {
        if (!g)
            return;
        readTheme();
    });
    static auto REFRESHED = Event::bus()->m_events.config.props_refreshed.listen([](bool) { settle(); });
    // Every way the world starts or stops settles it, whether or not a frame
    // is drawn then. A lock also lets the answers go at once, before Hyprland
    // marks the session locked.
    static auto LOCKED     = g_pSessionLockManager->m_events.lock.listen([] {
        letGo();
        settle();
    });
    static auto FULLSCREEN = Event::bus()->m_events.window.fullscreen.listen([](PHLWINDOW) { settle(); });
    const auto  watch = [](const PHLMONITOR& monitor) {
        if (!g || !monitor)
            return;
        g->watches.push_back(monitor->m_events.dpmsChanged.listen([] { settle(); }));
        g->watches.push_back(monitor->m_events.presented.listen([ref = PHLMONITORREF{monitor}](const Time::steady_tp&) {
            if (const auto monitor = ref.lock())
                onPresented(monitor);
        }));
    };
    for (const auto& monitor : State::monitorState()->monitors())
        watch(monitor);
    static auto ADDED   = Event::bus()->m_events.monitor.added.listen([watch](PHLMONITOR monitor) {
        watch(monitor);
        settle();
    });
    // A monitor that leaves takes its coarse world with it.
    static auto REMOVED = Event::bus()->m_events.monitor.removed.listen([](PHLMONITOR monitor) {
        if (const auto coarse = g->gpu.coarse.find(monitor->m_id); coarse != g->gpu.coarse.end()) {
            g_pHyprOpenGL->makeEGLCurrent();
            forget(coarse->second);
            g->gpu.coarse.erase(coarse);
        }
        settle();
    });

    return {"backdrop", "Draws the current Omarchy theme's backdrop between the wallpaper and the windows.", "Sean", "0.2"};
}

APICALL EXPORT void PLUGIN_EXIT() {
    closeFeed();
    if (g->settling)
        wl_event_source_remove(g->settling);
    if (!g->glassShader.empty())
        g_pHyprRenderer->reloadShaders("");
    g_pHyprRenderer->context().m_pass.removeAllOfType("CBackdropPass");
    g_pHyprOpenGL->makeEGLCurrent();
    deleteProgram();
    for (const auto& monitor : State::monitorState()->monitors())
        redraw(monitor);
    g.reset();
}
