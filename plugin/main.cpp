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
// and the glass, so this same frame draws the new backdrop. Otherwise the
// backdrop's own motion asks for frames: at the display's rate plugged in, 30
// a second on battery (plugin:backdrop:fps, plugin:backdrop:battery_fps).
//
// A backdrop can also draw text: the cinema-feed service sends the newest
// plaintext of the agents on this machine to a datagram socket the plugin owns,
// and a theme that ships glyphs.png draws it (specs/agent-rain.md).

#define WLR_USE_UNSTABLE

#include <hyprland/src/Compositor.hpp>
#include <hyprland/src/config/ConfigValue.hpp>
#include <hyprland/src/config/values/types/FloatValue.hpp>
#include <hyprland/src/config/values/types/IntValue.hpp>
#include <hyprland/src/workspace/HLWorkspace.hpp>
#include <hyprland/src/desktop/state/Fadeout.hpp>
#include <hyprland/src/desktop/state/FadingOutState.hpp>
#include <hyprland/src/desktop/state/FocusState.hpp>
#include <hyprland/src/desktop/state/WindowState.hpp>
#include <hyprland/src/desktop/view/window/Window.hpp>
#include <hyprland/src/desktop/view/window/WindowPresentation.hpp>
#include <hyprland/src/event/EventBus.hpp>
#include <hyprland/src/managers/SeatManager.hpp>
#include <hyprland/src/managers/SessionLockManager.hpp>
#include <hyprland/src/managers/input/InputManager.hpp>
#include <hyprland/src/protocols/InputMethodV2.hpp>
#include <hyprland/src/pointer/PointerManager.hpp>
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

    // The glass shows the backdrop through Hyprland's cached blur, and the
    // blur is the costly part of a frame. So a tick redraws the whole monitor
    // over the cached blur, and the blur itself is refreshed five times a
    // second: the whole frame always agrees with itself, and the glass trails
    // by at most a fifth of a second of slow motion, blurred.
    constexpr double GLASS_EVERY = 0.2; // seconds
    constexpr double FOCUS_EASE  = 0.32; // seconds
    // A window's and the pointer's velocity ease over this long, so one late
    // frame does not spike them.
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
        IMPULSE_TYPE,
        IMPULSE_VOICE,
    };
    // Texels per row of the window data texture: three per window.
    constexpr int    DATA_WIDTH = 256;
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
void main() {
    gl_Position = vec4(proj * vec3(pos, 1.0), 1.0);
    v_px = area.xy + pos * area.zw;
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
    // How far outside a window its frame may draw, in logical px.
    constexpr double FRAME_BAND = 48.0;

    using Rect = std::array<float, 4>;

    // A window as the backdrop sees it: where it is drawn, how faded, how round,
    // how it moves, how far it is lifted toward the viewer and how deep in the
    // stack it sits (0 on top).
    struct SShape {
        Rect                 rect{};
        float                alpha    = 1;
        float                rounding = 0;
        std::array<float, 2> velocity{};
        float                lift  = 0;
        float                depth = 0;
        uint64_t             id    = 0; // the window's stable id; 0 for a closed one fading out
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

    // What the world answers besides the windows: a change here redraws the
    // backdrop and leaves the glass on its own refresh (specs/depth.md, part 6).
    struct SAnswer {
        std::array<float, 4> pointer{}; // x, y, velocity x, y
        uint64_t             impulses = 0; // the impulse ring's generation
        float                voice    = 0; // speech loudness, 0 to 1
        bool                 operator==(const SAnswer&) const = default;
    };

    // How something moves between frames, so its velocity is known and its
    // lift eases. Kept by a window's stable id, and per monitor for the pointer.
    struct SMotion {
        Vector2D                              at;
        std::array<float, 2>                  velocity{};
        float                                 lift   = 0;
        bool                                  moving = false;
        std::chrono::steady_clock::time_point seen;
    };

    struct SImpulse {
        Vector2D                              at; // global logical px
        std::chrono::steady_clock::time_point start;
        float                                 strength = 1;
        int                                   kind     = 0;
    };

    struct SMonitor {
        SScene                                pending; // read for the frame being drawn
        SScene                                drawn;
        SAnswer                               answer; // read for the frame being drawn
        SAnswer                               answered;
        SMotion                               pointer;
        // What the focus decoration follows: the focused window, or, once it
        // has closed with nothing else focused here, its fadeout until that
        // has faded. A source is a window's stable id, which its fadeout
        // keeps; 0 is none. Any change of source eases from what was drawn.
        PHLWINDOWREF                          focusedWindow;
        WP<Desktop::IFadeout>                 focusFadeout;
        uint64_t                              focusFadeoutOf = 0;
        uint64_t                              source         = 0;
        Rect                                  focusFrom{};
        float                                 alphaFrom = 0;
        std::chrono::steady_clock::time_point focusMoved;
        bool                                  seen = false;
    };

    // One of the film's programs, the backdrop's or the frame's, and where its
    // uniforms are.
    struct SProgram {
        GLuint id = 0;
        GLint  proj, area, resolution, time, accent, background, foreground, focused, reserved, windowData, windowCount, focusedIndex, focusAlpha;
        GLint  feedUniform, feedCount, feedPos, glyphsUniform, feedPresence;
        GLint  pointer, impulses, impulseKinds, impulseCount, voice, frameWindow, frameAlpha, frameBorder;
    };

    // What the film's programs draw with: the unit square and the textures,
    // filled once a frame by the backdrop and read by every frame after it.
    struct SGpu {
        GLuint   vao = 0, vbo = 0, data = 0, feed = 0, glyphs = 0;
        uint64_t feedUploaded   = 0; // the feed change in the texture
        bool     glyphsUploaded = false;
        SProgram backdrop, frame;
    };

    struct SState {
        HANDLE                                  handle = nullptr;
        std::string                             source; // the theme's shader, empty when it has none
        std::array<float, 3>                    accent{1, 1, 1}, background{0, 0, 0}, foreground{1, 1, 1};
        // The colours the theme paints backgrounds in: these turn to glass.
        std::vector<std::array<float, 3>>       backgrounds;
        uint64_t                                generation = 1;
        uint64_t                                compiled   = 0;
        bool                                    framed     = false; // the film's shader defines frame()
        SGpu                                    gpu;
        // Frames a second of the backdrop's own motion, plugged in and on
        // battery; 0 is the display's own rate. Sean: "keep it native? or
        // atleast 30". Idle on the P16 the display's 120 cost about 9 W and 30
        // about 3.5 W (measured 2026-10-28), so native is for mains power.
        // Windows are followed every frame whatever these are.
        SP<Config::Values::CIntValue>           fps;
        SP<Config::Values::CIntValue>           batteryFps;
        // How much of a window's background stays: 1 solid, 0 clear glass.
        SP<Config::Values::CFloatValue>         glass;
        // How far the windows' depth goes (specs/depth.md, "Tiers"): 0 is the
        // backdrop alone, with no answers, no frames and no facts moving.
        SP<Config::Values::CIntValue>           depth;
        // Each monitor's sleep and wake, which can pass without a frame.
        std::vector<CHyprSignalListener>        sleeps;
        std::string                             glassShader; // the surface shader in use, empty for Hyprland's own
        wl_event_source*                        glassIdle = nullptr;
        bool                                    plugged = true;
        // Seconds of the backdrop's own motion, wrapping hourly, advanced by
        // the clock while the backdrop is seen.
        float                                   time = 0;
        std::chrono::steady_clock::time_point   lastTick, lastGlass, lastPowerCheck;
        wl_event_source*                        timer = nullptr;
        std::unordered_map<MONITORID, SMonitor> monitors;
        std::unordered_map<uint64_t, SMotion>   motion; // each window's, by stable id
        std::deque<SImpulse>                    impulses;
        uint64_t                                impulseGeneration = 0;
        uint64_t                                typed             = 0; // TYPE impulses so far
        // Voxtype's speech, as the feed last sent it.
        float                                   voice    = 0;
        bool                                    speaking = false;
        std::chrono::steady_clock::time_point   voiceReceived;
        // Hyprland keeps a closed window's rounding inside its fadeout, out of
        // reach, so the plugin keeps it beside: each window fadeout's rounding
        // from the moment it is made until Hyprland lets it go.
        std::unordered_map<const void*, float>  fadeoutRounding;
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

    void applyGlass();

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

    // The shader and its palette, both from the theme Omarchy has just applied.
    void readTheme() {
        const auto dir    = themeDir();
        const auto shader = readFile(dir + "/backdrop.frag");
        g->source         = shader.empty() ? "" : std::string(CONTRACT) + "\n#line 1\n" + shader;
        static const std::regex FRAME(R"(\bvec4\s+frame\s*\()");
        g->framed         = std::regex_search(shader, FRAME);

        static const std::regex PALETTE(R"re(^\s*([a-z_]+)\s*=\s*"#([0-9a-fA-F]{6})")re");
        std::istringstream      colors(readFile(dir + "/colors.toml"));
        g->backgrounds.clear();
        for (std::string line; std::getline(colors, line);) {
            std::smatch match;
            if (!std::regex_search(line, match, PALETTE))
                continue;
            const auto name  = match[1].str();
            const auto value = hexColor(match[2]);
            if (name == "accent")
                g->accent = value;
            else if (name == "foreground")
                g->foreground = value;
            if (name == "background")
                g->background = value;
            if (name == "background" || name == "dark_background" || name == "darker_background" || name == "lighter_background")
                g->backgrounds.push_back(value);
        }

        readGlyphs(dir + "/glyphs.png");
        g->generation++;

        // The backdrop's clock runs only while the theme has a backdrop; 0
        // disarms the timer.
        wl_event_source_timer_update(g->timer, g->source.empty() ? 0 : 1);
        // The glass waits for the rest of the config to load (plugin:backdrop:
        // glass comes later in the theme), so it is applied from the loop.
        if (!g->glassIdle)
            g->glassIdle = wl_event_loop_add_idle(g_pCompositor->m_wlEventLoop, [](void*) {
                if (!g)
                    return;
                g->glassIdle = nullptr;
                applyGlass();
            }, nullptr);
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
        for (const auto program : {gpu.backdrop.id, gpu.frame.id})
            if (program)
                glDeleteProgram(program);
        if (gpu.vbo)
            glDeleteBuffers(1, &gpu.vbo);
        if (gpu.vao)
            glDeleteVertexArrays(1, &gpu.vao);
        for (const auto texture : {gpu.data, gpu.feed, gpu.glyphs})
            if (texture)
                glDeleteTextures(1, &texture);
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
        p.windowData    = at("windowData");
        p.windowCount   = at("windowCount");
        p.focusedIndex  = at("focusedIndex");
        p.focusAlpha    = at("focusAlpha");
        p.feedUniform   = at("feed");
        p.feedCount     = at("feedCount");
        p.feedPos       = at("feedPos");
        p.glyphsUniform = at("glyphs");
        p.feedPresence  = at("feedPresence");
        p.pointer       = at("pointer");
        p.impulses      = at("impulses");
        p.impulseKinds  = at("impulseKinds");
        p.impulseCount  = at("impulseCount");
        p.voice         = at("voice");
        p.frameWindow   = at("frameWindow");
        p.frameAlpha    = at("frameAlpha");
        p.frameBorder   = at("frameBorder");
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

        glGenTextures(1, &gpu.data);
        glGenTextures(1, &gpu.feed);
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

    // Whether the world answers the desktop now, read at the moment it is
    // asked: depth on, animations on, the session unlocked and some monitor
    // showing the world. Nothing is collected while it does not.
    bool answering() {
        static auto ANIMATIONS = CConfigValue<Config::INTEGER>("animations:enabled");
        if (!g || g->source.empty() || g->depth->value() == 0 || !*ANIMATIONS || g_pSessionLockManager->isSessionLocked())
            return false;
        return std::ranges::any_of(State::monitorState()->monitors(), [](const auto& m) { return m->m_enabled && m->m_dpmsStatus && !covered(m); });
    }

    // Lets go of everything pending: impulses and the last voice reading.
    void letGo() {
        if (!g)
            return;
        forgetImpulses();
        g->voice    = 0;
        g->speaking = false;
    }

    // A change that stops the answers lets go of what is pending, so turning
    // depth or animations off and on again brings nothing back.
    void settleAnswers() {
        if (g && !answering())
            letGo();
    }

    void forgetImpulses() {
        if (g->impulses.empty())
            return;
        g->impulses.clear();
        g->impulseGeneration++;
    }

    void addImpulse(const Vector2D& at, float strength, int kind) {
        if (!answering())
            return;
        g->impulses.push_back({.at = at, .start = std::chrono::steady_clock::now(), .strength = strength, .kind = kind});
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
        addImpulse(w->position(state) + w->size(state) / 2.0, strength, kind);
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
                g->fadeoutRounding[fadeout.get()] = g->closing->presentation().rounding();
                for (auto& [id, state] : g->monitors)
                    if (state.focusedWindow.lock() == g->closing) {
                        state.focusFadeout   = fadeout;
                        state.focusFadeoutOf = g->closing->metadata().stableID();
                    }
            }
        }
        g->closing.reset();
        std::erase_if(g->seenFadeouts, [&](const void* f) { return !alive.contains(f); });
        std::erase_if(g->fadeoutRounding, [&](const auto& entry) { return !alive.contains(entry.first); });
    }

    // The windows Hyprland draws on this monitor in this frame, and those
    // fading out after closing, where they are drawn; and where attention is.
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
            const auto position = w->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT) + drawn.workspaceOffset + drawn.floatingOffset - monitor->m_position;
            const auto size     = w->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
            if (w == focused) {
                scene.focusedIndex = scene.shapes.size();
                focusedHere        = w;
            }
            auto& motion = g->motion[w->metadata().stableID()];
            if (step(motion, position + monitor->m_position, w == focused, now))
                addImpulse(position + monitor->m_position + size / 2.0, std::clamp(float(std::hypot(motion.velocity[0], motion.velocity[1]) / 3000.0), 0.25F, 1.F),
                           IMPULSE_LAND);
            const bool still = g->depth->value() == 0;
            scene.shapes.push_back({{float(position.x), float(position.y), float(size.x), float(size.y)}, drawn.fadeAlpha, w->presentation().rounding(),
                                    still ? std::array<float, 2>{} : motion.velocity, still ? 0.F : motion.lift, 0.F, w->metadata().stableID()});
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
            if (fadeout->monitor() != monitor || !isWindowFadeout(fadeout) ||
                (workspace && workspace != monitor->m_activeWorkspace && !(workspace->type() == Workspace::eWorkspaceType::SPECIAL && workspace->m_alpha->value() > 0.F)))
                continue;
            const auto position = fadeout->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT) - monitor->m_position;
            const auto size     = fadeout->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
            const auto rounding = g->fadeoutRounding.find(fadeout.get());
            if (!focusedHere && fadeout == state.focusFadeout.lock())
                scene.focusedIndex = scene.shapes.size();
            // Only a fadeout already running when the plugin loaded has none.
            scene.shapes.push_back({{float(position.x), float(position.y), float(size.x), float(size.y)}, fadeout->alpha(),
                                    rounding != g->fadeoutRounding.end() ? rounding->second : float(*ROUNDING)});
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
        const uint64_t source = focusedHere ? focusedHere->metadata().stableID() : scene.focusedIndex >= 0 ? state.focusFadeoutOf : 0;
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

    // The pointer over this monitor and the impulse ring as it stands, after
    // letting go of impulses that have run out.
    SAnswer readAnswer(PHLMONITOR monitor, SMonitor& state) {
        const auto now = std::chrono::steady_clock::now();
        while (!g->impulses.empty() && std::chrono::duration<double>(now - g->impulses.front().start).count() > IMPULSE_LIFE) {
            g->impulses.pop_front();
            g->impulseGeneration++;
        }
        // A window not drawn for ten seconds is closed or out of sight; it
        // starts still if it comes back.
        std::erase_if(g->motion, [&](const auto& entry) { return now - entry.second.seen > std::chrono::seconds(10); });
        if (!answering()) {
            settleAnswers();
            return {{float(monitor->m_size.x / 2.0), float(monitor->m_size.y / 2.0), 0.F, 0.F}, g->impulseGeneration, 0.F};
        }
        const auto at = Pointer::mgr()->untransformedPosition() - monitor->m_position;
        step(state.pointer, at, false, now);
        const float voice = now - g->voiceReceived <= VOICE_STALE ? g->voice : 0.F;
        return {{float(at.x), float(at.y), state.pointer.velocity[0], state.pointer.velocity[1]}, g->impulseGeneration, voice};
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
    }

    // Uploads the shapes, three texels each: (x, y, w, h), (alpha, rounding,
    // lift, depth) and (velocity x, y).
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

    void uploadShapes(const std::vector<SShape>& shapes) {
        const int          texels = std::max<int>(3 * shapes.size(), 1);
        const int          width  = std::min(texels, DATA_WIDTH);
        const int          height = (texels + DATA_WIDTH - 1) / DATA_WIDTH;
        std::vector<float> data(size_t(width) * height * 4, 0.F);
        for (size_t i = 0; i < shapes.size(); i++) {
            const auto at = data.begin() + i * 12;
            std::copy(shapes[i].rect.begin(), shapes[i].rect.end(), at);
            at[4] = shapes[i].alpha;
            at[5] = shapes[i].rounding;
            at[6] = shapes[i].lift;
            at[7] = shapes[i].depth;
            at[8] = shapes[i].velocity[0];
            at[9] = shapes[i].velocity[1];
        }
        upload(GL_RGBA32F, width, height, GL_RGBA, GL_FLOAT, data.data(), GL_NEAREST);
    }

    // Takes the newest valid snapshot waiting on the feed socket, at most
    // FEED_BUDGET datagrams a wakeup, never waiting: a truncated, oversized or
    // malformed one is dropped, and any valid one, a repeat too, says the
    // feed is alive.
    // A voice reading: the loudness now, and speech starting is an impulse
    // where dictated text arrives, along the focused window's lower edge.
    void onVoice(const uint8_t* data) {
        float    level    = 0;
        uint32_t speaking = 0;
        std::memcpy(&level, data, 4);
        std::memcpy(&speaking, data + 4, 4);
        if (!std::isfinite(level))
            return;
        if (!answering()) {
            g->voice    = 0;
            g->speaking = false;
            return;
        }
        g->voice         = std::clamp(level, 0.F, 1.F);
        g->voiceReceived = std::chrono::steady_clock::now();
        if (speaking && !g->speaking) {
            if (const auto window = Desktop::focusState()->window(); window && window->m_workspace && window->m_workspace->visible()) {
                const auto at   = window->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
                const auto size = window->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
                addImpulse({at.x + size.x / 2.0, at.y + size.y}, 1.F, IMPULSE_VOICE);
            }
        }
        g->speaking = speaking != 0;
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
    }

    void closeFeed() {
        if (g->feedSource)
            wl_event_source_remove(g->feedSource);
        if (g->feedFd >= 0) {
            close(g->feedFd);
            unlink(g->feedPath.c_str());
        }
        if (g->feedLock >= 0)
            close(g->feedLock);
    }

    // Glass: in a film theme, a window's background (the theme's background
    // colour) turns to glass, and everything drawn over it (text, icons, lines,
    // logos) keeps its full opacity (Sean, 2026-10-28: "the transparency should
    // effect the background but not the text"; "the little logo, line, stuff
    // like that, should all remain fully opaque").
    //
    // Hyprland fades a whole window by its opacity, text included, so the glass
    // is drawn where Hyprland draws windows: its own surface shader, the
    // version in this very build, with one step added after the window's pixel
    // is read: a pixel in one of the theme's background colours (background,
    // dark, darker, lighter) becomes glass at plugin:backdrop:glass, and every
    // other pixel keeps exactly the opacity the app drew it with. An earlier
    // colour-to-alpha un-mixing made grey text partly see-through (Sol, 2026-10-28). It runs only in the shader's
    // blur variant (film.lua turns render:use_shader_blur_blend on), which
    // Hyprland uses only for windows it blurs: a solid browser, video or photo
    // is never touched. Hyprland reads shaders from a directory before its
    // built-in ones, so the patched shader is written to one of the plugin's
    // and loaded with reloadShaders; Hyprland's own come back when the theme
    // has no backdrop or the plugin unloads.
    std::string glassShaderSource() {
        const auto glass = g->glass->value();
        if (g->source.empty() || glass >= 1.F || g->backgrounds.empty())
            return "";
        const auto found = std::ranges::find(SHADERS, std::string_view{"surface.frag"}, [](const auto& pair) { return pair.first; });
        if (found == SHADERS.end())
            return "";
        std::string source{found->second};
        const std::string output = "layout(location = 0) out vec4 fragColor;";
        const std::string read   = "#if USE_DISCARD && !USE_BLUR";
        const auto        at     = source.find(output);
        if (at == std::string::npos || source.find(output, at + 1) != std::string::npos || source.find(read) == std::string::npos) {
            HyprlandAPI::addNotification(g->handle, "[backdrop] this Hyprland's window shader has changed shape; windows stay solid", CHyprColor{1.0, 0.6, 0.2, 1.0}, 10000);
            return "";
        }
        std::string keys;
        for (const auto& c : g->backgrounds)
            keys += std::format("{}vec3({:.6f}, {:.6f}, {:.6f})", keys.empty() ? "" : ", ", c[0], c[1], c[2]);
        source.insert(at, std::format(R"(// omarchy-cinema glass: see the backdrop plugin.
const vec3  CINEMA_BACKGROUNDS[{}] = vec3[]({});
const float CINEMA_GLASS = {:.4f};
vec4 cinemaGlass(vec4 c) {{
    // Nothing to judge where the app drew nothing.
    if (c.a <= 0.0) return c;
    // Judged by colour alone, before the app's own alpha: a terminal that
    // draws its background half see-through gets the same glass as a window
    // that draws it solid (Sean: "the transparency in T3 code is also
    // mimicked in the terminal and other apps").
    vec3  rgb = c.rgb / c.a;
    float off = 1.0;
    for (int i = 0; i < {}; i++) {{
        vec3 e = abs(rgb - CINEMA_BACKGROUNDS[i]);
        off = min(off, max(max(e.r, e.g), e.b));
    }}
    // Only a background colour itself is background, within a step or two of
    // rounding. Panels, cards, fields, rows and dividers are shaded a few
    // steps off it, and they are interface, not background: they keep their
    // opacity with the text, icons and lines (Sean, 2026-10-28: "keep the text
    // opaque and other UI elements other than the background").
    float background = 1.0 - smoothstep(0.5 / 255.0, 2.5 / 255.0, off);
    float a = mix(c.a, CINEMA_GLASS, background);
    return vec4(rgb * a, a);
}}

)",
                                         g->backgrounds.size(), keys, glass, g->backgrounds.size()));
        source.insert(source.find(read), "#if USE_BLUR\n    pixColor = cinemaGlass(pixColor);\n#endif\n\n");
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
    // (logical px) placed by `proj` on `monitor`. The textures are on units
    // 5, 6 and 7: the lettering, the feed and the windows.
    void setUniforms(const SProgram& p, const PHLMONITOR& monitor, const SScene& scene, const SAnswer& answer, const Mat3x3& proj, const CBox& area,
                     std::chrono::steady_clock::time_point now) {
        const bool  lettered = !g->glyphPixels.empty();
        const float presence = feedPresence(now);
        glUseProgram(p.id);
        glUniformMatrix3fv(p.proj, 1, GL_TRUE, proj.getMatrix().data());
        glUniform4f(p.area, area.x, area.y, area.w, area.h);
        glUniform2f(p.resolution, monitor->m_size.x, monitor->m_size.y);
        glUniform1f(p.time, g->time);
        glUniform3fv(p.accent, 1, g->accent.data());
        glUniform3fv(p.background, 1, g->background.data());
        glUniform3fv(p.foreground, 1, g->foreground.data());
        glUniform4fv(p.focused, 1, scene.focus.data());
        glUniform4fv(p.reserved, 1, scene.reserved.data());
        glUniform1i(p.windowData, 7);
        glUniform1i(p.windowCount, scene.shapes.size());
        glUniform1i(p.focusedIndex, scene.focusedIndex);
        glUniform1f(p.focusAlpha, scene.focusAlpha);
        glUniform1i(p.glyphsUniform, 5);
        glUniform1i(p.feedUniform, 6);
        glUniform1i(p.feedCount, lettered && presence > 0 && g->gpu.feedUploaded ? int(g->feedCount) : 0);
        glUniform1i(p.feedPos, int(g->feedPos));
        glUniform1f(p.feedPresence, presence);
        glUniform4fv(p.pointer, 1, answer.pointer.data());
        glUniform1f(p.voice, answer.voice);
        // The impulses with their ages now, on this monitor's coordinates:
        // ages from the monotonic clock, so the hourly wrap of `time` never
        // reaches them.
        std::array<float, 4 * IMPULSES> impulses{};
        std::array<int, IMPULSES>       kinds{};
        int                             count = 0;
        for (const auto& impulse : g->impulses) {
            const auto at           = impulse.at - monitor->m_position;
            impulses[4 * count + 0] = float(at.x);
            impulses[4 * count + 1] = float(at.y);
            impulses[4 * count + 2] = std::chrono::duration<float>(now - impulse.start).count();
            impulses[4 * count + 3] = impulse.strength;
            kinds[count++]          = impulse.kind;
        }
        glUniform4fv(p.impulses, IMPULSES, impulses.data());
        glUniform1iv(p.impulseKinds, IMPULSES, kinds.data());
        glUniform1i(p.impulseCount, count);
    }

    // A pass is a guest in Hyprland's GL context. Hyprland skips binding a
    // program or texture unit it believes is still current, so a pass holds
    // one of these from its first GL call to its last, uploads included, and
    // leaves the program, vertex array and active unit as it found them.
    // Hyprland samples units 0 to 3 and 8, so the films' 5 to 7 stay bound.
    struct SGuest {
        GLint program = 0, vao = 0, unit = 0;
        SGuest() {
            glGetIntegerv(GL_CURRENT_PROGRAM, &program);
            glGetIntegerv(GL_VERTEX_ARRAY_BINDING, &vao);
            glGetIntegerv(GL_ACTIVE_TEXTURE, &unit);
        }
        ~SGuest() {
            glBindVertexArray(vao);
            glUseProgram(program);
            glActiveTexture(unit);
        }
    };

    // Draws the square with program state already set, once per damaged rect.
    void drawSquare(Render::CRenderContext& ctx, const std::function<void()>& set) {
        auto& gpu = g->gpu;
        for (int unit = 0; unit < 3; unit++) {
            glActiveTexture(GL_TEXTURE5 + unit);
            glBindTexture(GL_TEXTURE_2D, std::array{gpu.glyphs, gpu.feed, gpu.data}[unit]);
        }
        set();
        glBindVertexArray(gpu.vao);
        ctx.m_data.damage.forEachRect([&ctx](const auto& rect) {
            g_pHyprOpenGL->scissor(ctx, &rect, ctx.m_data.transformDamage);
            glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        });
        g_pHyprOpenGL->disableScissor();
    }

    class CBackdropPass : public IPassElement {
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
            glActiveTexture(GL_TEXTURE7);
            glBindTexture(GL_TEXTURE_2D, gpu.data);
            uploadShapes(m_scene.shapes);
            if (!g->glyphPixels.empty()) {
                glActiveTexture(GL_TEXTURE5);
                glBindTexture(GL_TEXTURE_2D, gpu.glyphs);
                if (!gpu.glyphsUploaded) {
                    upload(GL_R8, g->glyphWidth, g->glyphHeight, GL_RED, GL_UNSIGNED_BYTE, g->glyphPixels.data(), GL_LINEAR);
                    gpu.glyphsUploaded = true;
                }
                glActiveTexture(GL_TEXTURE6);
                glBindTexture(GL_TEXTURE_2D, gpu.feed);
                if (gpu.feedUploaded != g->feedChanges) {
                    upload(GL_R8, 128, FEED_RING / 128, GL_RED, GL_UNSIGNED_BYTE, g->feedRing.data(), GL_NEAREST);
                    gpu.feedUploaded = g->feedChanges;
                }
            }
            const auto now  = std::chrono::steady_clock::now();
            const auto proj = g_pHyprRenderer->projectBoxToTarget(ctx, CBox{0, 0, monitor->m_transformedSize.x, monitor->m_transformedSize.y});
            drawSquare(ctx, [&] { setUniforms(gpu.backdrop, monitor, m_scene, m_answer, proj, CBox{0, 0, monitor->m_size.x, monitor->m_size.y}, now); });
            return {};
        }

        bool needsLiveBlur(Render::CRenderContext&) override {
            return false;
        }
        bool needsPrecomputeBlur(Render::CRenderContext&) override {
            return false;
        }
        const char* passName() override {
            return "CBackdropPass";
        }
        ePassElementType type() override {
            return EK_CUSTOM;
        }
        // The backdrop covers the whole monitor, so Hyprland can skip drawing
        // the wallpaper under it.
        std::optional<CBox> boundingBox(Render::CRenderContext&) override {
            const auto monitor = m_monitor.lock();
            return monitor ? std::optional<CBox>(CBox{0, 0, monitor->m_size.x, monitor->m_size.y}) : std::nullopt;
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

    // A window's edge in the film's world (specs/depth.md, part 2): the
    // film's frame(px, i) over a band round the window, drawn in the window's
    // own pass, so it moves, tilts and fades with it. It reads the scene and
    // textures the backdrop drew this frame.
    class CFramePass : public IPassElement {
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
            CBox       box   = area.copy().scale(monitor->m_scale);
            ctx.m_data.renderModif.applyToBox(box);
            const auto   proj = g_pHyprRenderer->projectBoxToTarget(ctx, box);
            const auto   now  = std::chrono::steady_clock::now();
            const SGuest guest;
            g_pHyprRenderer->blend(true);
            drawSquare(ctx, [&] {
                setUniforms(g->gpu.frame, monitor, state.drawn, state.answered, proj, area, now);
                glUniform1i(g->gpu.frame.frameWindow, index);
                glUniform1f(g->gpu.frame.frameAlpha, m_alpha);
                glUniform1f(g->gpu.frame.frameBorder, m_border);
            });
            return {};
        }

        bool needsLiveBlur(Render::CRenderContext&) override {
            return false;
        }
        bool needsPrecomputeBlur(Render::CRenderContext&) override {
            return false;
        }
        const char* passName() override {
            return "CFramePass";
        }
        ePassElementType type() override {
            return EK_CUSTOM;
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

    // The frame's place on every window: above it, below its popups, taking
    // no room and no input.
    class CFrameDecoration : public IHyprWindowDecoration {
      public:
        CFrameDecoration(PHLWINDOW window) : IHyprWindowDecoration(window) {}

        SDecorationPositioningInfo getPositioningInfo() override {
            SDecorationPositioningInfo info;
            info.policy         = DECORATION_POSITION_ABSOLUTE;
            info.desiredExtents = {{FRAME_BAND, FRAME_BAND}, {FRAME_BAND, FRAME_BAND}};
            info.edges          = DECORATION_EDGE_BOTTOM | DECORATION_EDGE_LEFT | DECORATION_EDGE_RIGHT | DECORATION_EDGE_TOP;
            return info;
        }
        void onPositioningReply(const SDecorationPositioningReply&) override {}
        // Not in a workspace drawn on its own (a capture or snapshot): its
        // scene is not the monitor's.
        void draw(Render::CRenderContext& ctx, PHLMONITOR monitor, float const& a, const Render::SWindowRenderPresentation&) override {
            const auto window = owningWindow();
            if (!g || !g->framed || g->depth->value() == 0 || !window || ctx.readOnlyEffects())
                return;
            Render::IHyprRenderer::addPassElement(ctx, makeUnique<CFramePass>(monitor, window->metadata().stableID(), a, float(window->presentation().borderSize())));
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
            return DECORATION_LAYER_OVER;
        }
        uint64_t getDecorationFlags() override {
            return DECORATION_NON_SOLID;
        }
        std::string getDisplayName() override {
            return "cinema frame";
        }
    };

    void addFrame(const PHLWINDOW& window) {
        if (g && window)
            HyprlandAPI::addWindowDecoration(g->handle, window, makeShared<CFrameDecoration>(window));
    }

    void onPre(PHLMONITOR monitor) {
        if (!g || g->source.empty())
            return;
        auto& state   = g->monitors[monitor->m_id];
        state.pending = readScene(monitor, state);
        state.answer  = readAnswer(monitor, state);
        if (state.pending != state.drawn)
            redraw(monitor);
        else if (state.answer != state.answered)
            g_pHyprRenderer->damageMonitor(monitor);
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
        auto& state    = g->monitors[event.monitor->m_id];
        state.drawn    = state.pending;
        state.answered = state.answer;
        Render::IHyprRenderer::addPassElement(ctx, makeUnique<CBackdropPass>(event.monitor, state.pending, state.answer));
    }

    // Plugged in: any mains or USB-C supply online.
    bool plugged() {
        std::error_code error;
        for (const auto& supply : std::filesystem::directory_iterator("/sys/class/power_supply", error)) {
            const auto type = readFile(supply.path() / "type");
            if ((type.starts_with("Mains") || type.starts_with("USB")) && readFile(supply.path() / "online").starts_with("1"))
                return true;
        }
        return false;
    }

    // The backdrop's own motion. Time stands still while there is nothing to
    // see it on: animations off, the session locked, or every monitor asleep
    // or showing a fullscreen window. readTheme starts and stops the timer.
    int onTick(void*) {
        if (!g)
            return 0;
        const auto now = std::chrono::steady_clock::now();
        if (now - g->lastPowerCheck > std::chrono::seconds(2)) {
            g->plugged        = plugged();
            g->lastPowerCheck = now;
        }

        float fastest = 0;
        for (const auto& monitor : State::monitorState()->monitors())
            fastest = std::max(fastest, monitor->m_refreshRate);
        const auto setting = (g->plugged ? g->fps : g->batteryFps)->value();
        const auto rate    = setting > 0 ? float(setting) : std::max(fastest, 1.F);
        wl_event_source_timer_update(g->timer, std::max(1, int(1000 / rate)));

        const float elapsed = std::min(std::chrono::duration<float>(now - g->lastTick).count(), 0.1F);
        g->lastTick         = now;
        static auto ANIMATIONS = CConfigValue<Config::INTEGER>("animations:enabled");
        if (!*ANIMATIONS || g_pSessionLockManager->isSessionLocked())
            return 0;

        const bool glass = now - g->lastGlass >= std::chrono::duration<double>(GLASS_EVERY);
        bool       seen  = false;
        for (const auto& monitor : State::monitorState()->monitors()) {
            if (!monitor->m_enabled || !monitor->m_dpmsStatus || covered(monitor))
                continue;
            seen = true;
            g_pHyprRenderer->damageMonitor(monitor);
            if (glass)
                monitor->m_blurFBDirty = true;
        }
        if (glass)
            g->lastGlass = now;
        if (seen)
            g->time = std::fmod(g->time + elapsed, 3600.F);
        return 0;
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
    g->fps        = makeShared<Config::Values::CIntValue>("plugin:backdrop:fps", "Frames a second of the backdrop's own motion plugged in; 0 is the display's rate",
                                                          0, Config::Values::SIntValueOptions{.min = 0, .max = 1000});
    g->batteryFps = makeShared<Config::Values::CIntValue>("plugin:backdrop:battery_fps", "Frames a second of the backdrop's own motion on battery; 0 is the display's rate",
                                                          30, Config::Values::SIntValueOptions{.min = 0, .max = 1000});
    g->glass      = makeShared<Config::Values::CFloatValue>("plugin:backdrop:glass", "How much of a window's background stays: 1 solid, 0 clear glass", 1.F,
                                                            Config::Values::SFloatValueOptions{.min = 0.F, .max = 1.F});
    HyprlandAPI::addConfigValueV2(handle, g->fps);
    HyprlandAPI::addConfigValueV2(handle, g->batteryFps);
    g->depth      = makeShared<Config::Values::CIntValue>("plugin:backdrop:depth", "How far windows' depth goes: 0 the backdrop alone (no answers or frames), 1 to 3 the tiers of specs/depth.md", 2,
                                                         Config::Values::SIntValueOptions{.min = 0, .max = 3});
    HyprlandAPI::addConfigValueV2(handle, g->glass);
    HyprlandAPI::addConfigValueV2(handle, g->depth);
    g->plugged  = plugged();
    g->lastTick = g->lastGlass = g->lastPowerCheck = std::chrono::steady_clock::now();
    g->timer = wl_event_loop_add_timer(g_pCompositor->m_wlEventLoop, onTick, nullptr);
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
        addFrame(window);
        windowImpulse(window, Desktop::View::IGeometric::GEOMETRIC_GOAL, 1.F, IMPULSE_OPEN);
    });
    for (const auto& window : Desktop::windowState()->windows())
        addFrame(window);
    static auto ACTIVE = Event::bus()->m_events.window.active.listen(
        [](PHLWINDOW window, Desktop::eFocusReason) { windowImpulse(window, Desktop::View::IGeometric::GEOMETRIC_CURRENT, 0.6F, IMPULSE_FOCUS); });
    // The pointer's light follows it in the same frame: a move draws its
    // monitor again (a hardware cursor alone would not).
    static auto MOVE = Event::bus()->m_events.input.mouse.move.listen([](const Vector2D& at, Event::SCallbackInfo&) {
        if (!g || g->source.empty())
            return;
        if (const auto monitor = State::monitorState()->query().vec(at).run())
            g_pHyprRenderer->damageMonitor(monitor);
    });
    // Typing (specs/depth.md, part 1): a printable key, with no modifier held
    // but Shift (AltGr still types), into a client window holding the
    // keyboard, with no input method grab and the session unlocked. The key
    // only decides this; nothing of it is kept.
    static auto KEY = Event::bus()->m_events.input.keyboard.key.listen([](const IKeyboard::SKeyEvent& event, Event::SCallbackInfo&) {
        if (!g || g->source.empty() || event.state != WL_KEYBOARD_KEY_STATE_PRESSED || g_pSessionLockManager->isSessionLocked())
            return;
        const auto window   = Desktop::focusState()->window();
        const auto keyboard = g_pSeatManager->m_keyboard.lock();
        if (!window || !keyboard || !keyboard->m_xkbState || g_pSeatManager->m_state.keyboardFocus.lock() != window->wlSurface()->resource())
            return;
        if (const auto ime = g_pInputManager->m_relay.m_inputMethod.lock(); ime && ime->hasGrab())
            return;
        for (const char* mod : {XKB_MOD_NAME_CTRL, XKB_MOD_NAME_ALT, XKB_MOD_NAME_LOGO})
            if (xkb_state_mod_name_is_active(keyboard->m_xkbState, mod, XKB_STATE_MODS_EFFECTIVE) > 0)
                return;
        const auto code = xkb_keysym_to_utf32(xkb_state_key_get_one_sym(keyboard->m_xkbState, event.keycode + 8));
        if (code < 0x20 || code == 0x7f)
            return;
        // Along the window's lower edge, spread by the golden ratio so a burst
        // of typing walks across it.
        const auto   at    = window->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
        const auto   size  = window->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
        const double along = std::fmod(0.5 + double(g->typed++) * 0.6180339887, 1.0);
        if (window->m_workspace && window->m_workspace->visible())
            addImpulse({at.x + size.x * along, at.y + size.y}, 0.5F, IMPULSE_TYPE);
    });
    static auto RELOADED = Event::bus()->m_events.config.reloaded.listen([] {
        if (!g)
            return;
        readTheme();
        settleAnswers();
    });
    static auto REFRESHED = Event::bus()->m_events.config.props_refreshed.listen([](bool) { settleAnswers(); });
    // Every way the world stops answering lets pending answers go when it
    // happens, whether or not a frame is drawn then: a config change, the
    // session locking, a window going fullscreen, a monitor going to sleep.
    // Hyprland announces a lock before it marks the session locked, so the
    // lock lets go at once instead of asking whether the world still answers.
    static auto LOCKED     = g_pSessionLockManager->m_events.lock.listen([] { letGo(); });
    static auto FULLSCREEN = Event::bus()->m_events.window.fullscreen.listen([](PHLWINDOW) { settleAnswers(); });
    const auto  watchSleep = [](const PHLMONITOR& monitor) {
        if (g && monitor)
            g->sleeps.push_back(monitor->m_events.dpmsChanged.listen([] { settleAnswers(); }));
    };
    for (const auto& monitor : State::monitorState()->monitors())
        watchSleep(monitor);
    static auto ADDED = Event::bus()->m_events.monitor.added.listen([watchSleep](PHLMONITOR monitor) { watchSleep(monitor); });

    return {"backdrop", "Draws the current Omarchy theme's backdrop between the wallpaper and the windows.", "Sean", "0.2"};
}

APICALL EXPORT void PLUGIN_EXIT() {
    if (g->timer)
        wl_event_source_remove(g->timer);
    closeFeed();
    if (g->glassIdle)
        wl_event_source_remove(g->glassIdle);
    if (!g->glassShader.empty())
        g_pHyprRenderer->reloadShaders("");
    g_pHyprRenderer->context().m_pass.removeAllOfType("CBackdropPass");
    g_pHyprOpenGL->makeEGLCurrent();
    deleteProgram();
    for (const auto& monitor : State::monitorState()->monitors())
        redraw(monitor);
    g.reset();
}
