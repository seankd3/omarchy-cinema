// Draws the current Omarchy theme's backdrop between the wallpaper and the
// windows, inside the frame Hyprland is drawing, from the windows' geometry in
// that frame, so it never trails them.
//
// A theme with a backdrop ships backdrop.frag, a fragment shader written
// against contract.glsl, and loads this plugin from its hyprland.lua. A theme
// switch reloads Hyprland's config: the shader and palette are read again from
// the applied theme then, and a theme that does not load the plugin unloads it.
//
// Hyprland advances its animations, then emits render.pre, then reads the
// frame's damage. At render.pre the plugin reads the windows as they will be
// drawn; if they differ from what it last drew, it damages the whole monitor
// and the glass, so this same frame draws the new backdrop. Otherwise the
// backdrop's own motion asks for frames at plugin:backdrop:fps.

#define WLR_USE_UNSTABLE

#include <hyprland/src/Compositor.hpp>
#include <hyprland/src/config/ConfigValue.hpp>
#include <hyprland/src/config/values/types/IntValue.hpp>
#include <hyprland/src/desktop/Workspace.hpp>
#include <hyprland/src/desktop/state/Fadeout.hpp>
#include <hyprland/src/desktop/state/FadingOutState.hpp>
#include <hyprland/src/desktop/state/FocusState.hpp>
#include <hyprland/src/desktop/state/WindowState.hpp>
#include <hyprland/src/desktop/view/Window.hpp>
#include <hyprland/src/event/EventBus.hpp>
#include <hyprland/src/managers/SessionLockManager.hpp>
#include <hyprland/src/managers/fullscreen/FullscreenController.hpp>
#include <hyprland/src/output/Monitor.hpp>
#include <hyprland/src/plugins/PluginAPI.hpp>
#include <hyprland/src/render/OpenGL.hpp>
#include <hyprland/src/render/Renderer.hpp>
#include <hyprland/src/render/pass/PassElement.hpp>
#include <hyprland/src/state/MonitorState.hpp>

#include <GLES3/gl32.h>

#include <array>
#include <chrono>
#include <cmath>
#include <fstream>
#include <regex>
#include <sstream>
#include <unordered_map>
#include <unordered_set>

using namespace Render::GL;

namespace {

    // The glass shows the backdrop through Hyprland's cached blur, and the
    // blur is the costly part of a frame. So a tick redraws the whole monitor
    // over the cached blur, and every sixth tick refreshes the blur too: the
    // whole frame always agrees with itself, and the glass trails by at most
    // five ticks of slow motion, blurred.
    constexpr int    GLASS_EVERY = 6;
    constexpr double FOCUS_EASE  = 0.32; // seconds
    // Texels per row of the window data texture: two per window.
    constexpr int    DATA_WIDTH = 256;

    const char* CONTRACT =
#include "contract.inc"
        ;

    const char* VERTEX = R"(#version 300 es
uniform mat3 proj;
uniform vec2 resolution;
in vec2 pos;
out vec2 v_px;
void main() {
    gl_Position = vec4(proj * vec3(pos, 1.0), 1.0);
    v_px = pos * resolution;
}
)";

    using Rect = std::array<float, 4>;

    // A window as the backdrop sees it: where it is drawn, how faded, how round.
    struct SShape {
        Rect  rect{};
        float alpha    = 1;
        float rounding = 0;
        bool  operator==(const SShape&) const = default;
    };

    // What the backdrop shows on one monitor, apart from its own motion.
    struct SScene {
        std::vector<SShape> shapes;
        int                 focusedIndex = -1;
        Rect                focus{};
        bool                operator==(const SScene&) const = default;
    };

    struct SMonitor {
        SScene                                pending; // read for the frame being drawn
        SScene                                drawn;
        PHLWINDOWREF                          focusedWindow;
        Rect                                  focusFrom{};
        std::chrono::steady_clock::time_point focusMoved;
        bool                                  seen = false;
    };

    struct SProgram {
        GLuint id = 0, vao = 0, vbo = 0, data = 0;
        GLint  proj, resolution, time, accent, background, foreground, focused, windowData, windowCount, focusedIndex;
    };

    struct SState {
        HANDLE                                  handle = nullptr;
        std::string                             source; // the theme's shader, empty when it has none
        std::array<float, 3>                    accent{1, 1, 1}, background{0, 0, 0}, foreground{1, 1, 1};
        uint64_t                                generation = 1;
        uint64_t                                compiled   = 0;
        SProgram                                program;
        // Frames a second of the backdrop's own motion; 0 holds it still. 15 by
        // default: on the P16 with Jarvis on workspace 1, idle, 30 cost about
        // 5 W and 10 about 1.6 W (measured 2026-10-28). Windows are followed
        // every frame whatever this is.
        SP<Config::Values::CIntValue>           fps;
        float                                   time  = 0;
        uint64_t                                ticks = 0;
        wl_event_source*                        timer = nullptr;
        std::unordered_map<MONITORID, SMonitor> monitors;
        // Hyprland keeps a closed window's rounding inside its fadeout, out of
        // reach, so the plugin keeps it beside: each window fadeout's rounding
        // from the moment it is made until Hyprland lets it go.
        std::unordered_map<const void*, float>  fadeoutRounding;
        std::unordered_set<const void*>         seenFadeouts;
        std::optional<float>                    closing; // the window being closed
    };

    UP<SState> g;

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

    // The shader and its palette, both from the theme Omarchy has just applied.
    void readTheme() {
        const auto dir    = themeDir();
        const auto shader = readFile(dir + "/backdrop.frag");
        g->source         = shader.empty() ? "" : std::string(CONTRACT) + "\n#line 1\n" + shader;

        static const std::regex PALETTE(R"re(^\s*(accent|background|foreground)\s*=\s*"#([0-9a-fA-F]{6})")re");
        std::istringstream      colors(readFile(dir + "/colors.toml"));
        for (std::string line; std::getline(colors, line);) {
            std::smatch match;
            if (!std::regex_search(line, match, PALETTE))
                continue;
            (match[1] == "accent" ? g->accent : match[1] == "background" ? g->background : g->foreground) = hexColor(match[2]);
        }
        g->generation++;
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
        auto& p = g->program;
        if (p.id)
            glDeleteProgram(p.id);
        if (p.vbo)
            glDeleteBuffers(1, &p.vbo);
        if (p.vao)
            glDeleteVertexArrays(1, &p.vao);
        if (p.data)
            glDeleteTextures(1, &p.data);
        p = {};
    }

    // Builds the theme's program once per theme read; called with the render
    // context current. A shader that does not compile is reported once and the
    // backdrop stays off until the theme is read again.
    bool program() {
        if (g->compiled == g->generation)
            return g->program.id != 0;
        g->compiled = g->generation;
        deleteProgram();
        if (g->source.empty())
            return false;

        std::string  log;
        const GLuint vert = compileStage(GL_VERTEX_SHADER, VERTEX, log);
        const GLuint frag = vert ? compileStage(GL_FRAGMENT_SHADER, g->source, log) : 0;
        if (!vert || !frag) {
            if (vert)
                glDeleteShader(vert);
            HyprlandAPI::addNotification(g->handle, "[backdrop] the theme's backdrop.frag does not compile: " + log, CHyprColor{1.0, 0.2, 0.2, 1.0}, 15000);
            return false;
        }

        auto& p = g->program;
        p.id    = glCreateProgram();
        glAttachShader(p.id, vert);
        glAttachShader(p.id, frag);
        glBindAttribLocation(p.id, 0, "pos");
        glLinkProgram(p.id);
        glDeleteShader(vert);
        glDeleteShader(frag);
        GLint ok = 0;
        glGetProgramiv(p.id, GL_LINK_STATUS, &ok);
        if (!ok) {
            HyprlandAPI::addNotification(g->handle, "[backdrop] the theme's backdrop.frag does not link", CHyprColor{1.0, 0.2, 0.2, 1.0}, 15000);
            deleteProgram();
            return false;
        }

        p.proj         = glGetUniformLocation(p.id, "proj");
        p.resolution   = glGetUniformLocation(p.id, "resolution");
        p.time         = glGetUniformLocation(p.id, "time");
        p.accent       = glGetUniformLocation(p.id, "accent");
        p.background   = glGetUniformLocation(p.id, "background");
        p.foreground   = glGetUniformLocation(p.id, "foreground");
        p.focused      = glGetUniformLocation(p.id, "focused");
        p.windowData   = glGetUniformLocation(p.id, "windowData");
        p.windowCount  = glGetUniformLocation(p.id, "windowCount");
        p.focusedIndex = glGetUniformLocation(p.id, "focusedIndex");

        GLint vao = 0, buffer = 0;
        glGetIntegerv(GL_VERTEX_ARRAY_BINDING, &vao);
        glGetIntegerv(GL_ARRAY_BUFFER_BINDING, &buffer);
        // The unit square, as Hyprland's own quads are drawn.
        const std::array<float, 8> quad = {1, 0, 0, 0, 1, 1, 0, 1};
        glGenVertexArrays(1, &p.vao);
        glBindVertexArray(p.vao);
        glGenBuffers(1, &p.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, p.vbo);
        glBufferData(GL_ARRAY_BUFFER, sizeof(quad), quad.data(), GL_STATIC_DRAW);
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
        glBindVertexArray(vao);
        glBindBuffer(GL_ARRAY_BUFFER, buffer);

        glGenTextures(1, &p.data);
        return true;
    }

    float easeOut(float t) {
        return 1.F - std::pow(1.F - t, 3.F);
    }

    // A window's fade as Hyprland draws it (renderWindow's fadeAlpha, Hyprland
    // 0.56.2 src/render/Renderer.cpp:588), so the shape fades with the window
    // through closing, fullscreen, layout changes and workspace moves.
    float renderedAlpha(const PHLWINDOW& w) {
        using namespace Desktop::View;
        const auto workspace     = w->m_workspace;
        const bool workspaceFade = w->m_monitorMovedFrom != -1 && (!workspace || !workspace->isVisible());
        return w->alphaValue(WINDOW_ALPHA_FADE) * w->alphaValue(WINDOW_ALPHA_FULLSCREEN) * w->alphaValue(WINDOW_ALPHA_LAYOUT) *
            (w->m_pinned || workspaceFade || !workspace ? 1.F : workspace->m_alpha->value()) * (workspaceFade ? w->alphaValue(WINDOW_ALPHA_MOVE_TO_WORKSPACE) : 1.F) *
            w->alphaValue(WINDOW_ALPHA_MOVE_FROM_WORKSPACE);
    }

    bool isWindowFadeout(const SP<Desktop::IFadeout>& fadeout) {
        const auto plane = fadeout->plane();
        return plane == Desktop::FADEOUT_PLANE_WINDOW_TILED || plane == Desktop::FADEOUT_PLANE_WINDOW_FLOATING || plane == Desktop::FADEOUT_PLANE_WINDOW_OVER_FULLSCREEN;
    }

    // Hyprland emits window.close, then makes that window's fadeout in the
    // same call (Hyprland 0.56.2 src/desktop/view/Window.cpp:2575, 2701), so
    // the window fadeouts that appear after a close event belong to the window
    // it named. Run at each close event and before reading a scene; forgets
    // fadeouts Hyprland has let go.
    void claimFadeouts() {
        std::unordered_set<const void*> alive;
        for (const auto& fadeout : Desktop::fadingOutState()->fadeouts()) {
            if (!isWindowFadeout(fadeout))
                continue;
            alive.insert(fadeout.get());
            if (g->seenFadeouts.insert(fadeout.get()).second && g->closing)
                g->fadeoutRounding[fadeout.get()] = *g->closing;
        }
        g->closing.reset();
        std::erase_if(g->seenFadeouts, [&](const void* f) { return !alive.contains(f); });
        std::erase_if(g->fadeoutRounding, [&](const auto& entry) { return !alive.contains(entry.first); });
    }

    // The windows Hyprland draws on this monitor in this frame, and those
    // fading out after closing, where they are drawn; and where attention is.
    SScene readScene(PHLMONITOR monitor, SMonitor& state) {
        SScene     scene;
        const auto focused = Desktop::focusState()->window();
        PHLWINDOW  focusedHere;

        for (const auto& w : Desktop::windowState()->windows()) {
            if (!w->m_isMapped || w->isHidden() || !w->m_workspace || !g_pHyprRenderer->shouldRenderWindow(w, monitor))
                continue;
            const auto position = w->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT) + (w->m_pinned ? Vector2D{} : w->m_workspace->m_renderOffset->value()) +
                w->m_floatingOffset - monitor->m_position;
            const auto size = w->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
            if (w == focused) {
                scene.focusedIndex = scene.shapes.size();
                focusedHere        = w;
            }
            scene.shapes.push_back({{float(position.x), float(position.y), float(size.x), float(size.y)}, renderedAlpha(w), w->rounding()});
        }

        // Closed windows fading out, on the workspaces Hyprland draws them on:
        // the active one and every special workspace still visible, even one
        // being dismissed (Hyprland 0.56.2 src/render/Renderer.cpp:1205, 3233).
        claimFadeouts();
        static auto ROUNDING = CConfigValue<Config::INTEGER>("decoration:rounding");
        for (const auto& fadeout : Desktop::fadingOutState()->fadeouts()) {
            const auto workspace = fadeout->workspace().lock();
            if (fadeout->monitor() != monitor || !isWindowFadeout(fadeout) ||
                (workspace && workspace != monitor->m_activeWorkspace && !(workspace->m_isSpecialWorkspace && workspace->m_alpha->value() > 0.F)))
                continue;
            const auto position = fadeout->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT) - monitor->m_position;
            const auto size     = fadeout->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT);
            const auto rounding = g->fadeoutRounding.find(fadeout.get());
            // Only a fadeout already running when the plugin loaded has none.
            scene.shapes.push_back({{float(position.x), float(position.y), float(size.x), float(size.y)}, fadeout->alpha(),
                                    rounding != g->fadeoutRounding.end() ? rounding->second : float(*ROUNDING)});
        }

        const Rect middle = {float(monitor->m_size.x * 0.3), float(monitor->m_size.y * 0.3), float(monitor->m_size.x * 0.4), float(monitor->m_size.y * 0.4)};
        const Rect target = scene.focusedIndex < 0 ? middle : scene.shapes[scene.focusedIndex].rect;

        // Focus moving to another window eases across; a focused window that
        // moves is followed exactly.
        const auto now = std::chrono::steady_clock::now();
        if (!state.seen) {
            state.seen       = true;
            state.focusFrom  = target;
            state.focusMoved = now - std::chrono::seconds(1);
        } else if (state.focusedWindow.lock() != focusedHere) {
            state.focusFrom  = state.drawn.focus;
            state.focusMoved = now;
        }
        state.focusedWindow = focusedHere;

        const float k = easeOut(std::min(1.F, float(std::chrono::duration<double>(now - state.focusMoved).count() / FOCUS_EASE)));
        for (size_t i = 0; i < 4; i++)
            scene.focus[i] = state.focusFrom[i] + (target[i] - state.focusFrom[i]) * k;
        return scene;
    }

    bool covered(PHLMONITOR monitor) {
        return Fullscreen::controller()->getFullscreenModes(monitor).internal == Fullscreen::FSMODE_FULLSCREEN;
    }

    // Asks Hyprland to draw the whole monitor again, glass included.
    void redraw(PHLMONITOR monitor) {
        g_pHyprRenderer->damageMonitor(monitor);
        monitor->m_blurFBDirty = true;
    }

    // Uploads the shapes, two texels each: (x, y, w, h) and (alpha, rounding).
    void uploadShapes(const std::vector<SShape>& shapes) {
        const int          texels = std::max<int>(2 * shapes.size(), 1);
        const int          width  = std::min(texels, DATA_WIDTH);
        const int          height = (texels + DATA_WIDTH - 1) / DATA_WIDTH;
        std::vector<float> data(size_t(width) * height * 4, 0.F);
        for (size_t i = 0; i < shapes.size(); i++) {
            std::copy(shapes[i].rect.begin(), shapes[i].rect.end(), data.begin() + i * 8);
            data[i * 8 + 4] = shapes[i].alpha;
            data[i * 8 + 5] = shapes[i].rounding;
        }

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
        glPixelStorei(GL_UNPACK_ALIGNMENT, 4);

        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, width, height, 0, GL_RGBA, GL_FLOAT, data.data());
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);

        glBindBuffer(GL_PIXEL_UNPACK_BUFFER, unpackBuffer);
        glPixelStorei(GL_UNPACK_ROW_LENGTH, rowLength);
        glPixelStorei(GL_UNPACK_SKIP_ROWS, skipRows);
        glPixelStorei(GL_UNPACK_SKIP_PIXELS, skipPixels);
        glPixelStorei(GL_UNPACK_ALIGNMENT, alignment);
    }

    class CBackdropPass : public IPassElement {
      public:
        CBackdropPass(PHLMONITOR monitor, SScene scene) : m_monitor(monitor), m_scene(std::move(scene)) {}

        std::vector<UP<IPassElement>> draw() override {
            const auto monitor = m_monitor.lock();
            if (!monitor)
                return {};

            // Hyprland skips binding a program it believes is still bound, and
            // binds its own vertex arrays and textures by unit; so everything
            // touched here is put back as it was found.
            GLint program = 0, vao = 0, activeTexture = 0, texture = 0;
            glGetIntegerv(GL_CURRENT_PROGRAM, &program);
            glGetIntegerv(GL_VERTEX_ARRAY_BINDING, &vao);
            glGetIntegerv(GL_ACTIVE_TEXTURE, &activeTexture);
            glActiveTexture(GL_TEXTURE7);
            glGetIntegerv(GL_TEXTURE_BINDING_2D, &texture);

            auto& p = g->program;
            glBindTexture(GL_TEXTURE_2D, p.data);
            uploadShapes(m_scene.shapes);

            const CBox box  = {0, 0, monitor->m_transformedSize.x, monitor->m_transformedSize.y};
            const auto proj = g_pHyprRenderer->projectBoxToTarget(box);
            glUseProgram(p.id);
            glUniformMatrix3fv(p.proj, 1, GL_TRUE, proj.getMatrix().data());
            glUniform2f(p.resolution, monitor->m_size.x, monitor->m_size.y);
            glUniform1f(p.time, g->time);
            glUniform3fv(p.accent, 1, g->accent.data());
            glUniform3fv(p.background, 1, g->background.data());
            glUniform3fv(p.foreground, 1, g->foreground.data());
            glUniform4fv(p.focused, 1, m_scene.focus.data());
            glUniform1i(p.windowData, 7);
            glUniform1i(p.windowCount, m_scene.shapes.size());
            glUniform1i(p.focusedIndex, m_scene.focusedIndex);

            glBindVertexArray(p.vao);
            auto& data = g_pHyprRenderer->m_renderData;
            data.damage.forEachRect([&data](const auto& rect) {
                g_pHyprOpenGL->scissor(&rect, data.transformDamage);
                glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
            });
            g_pHyprOpenGL->scissor(nullptr);

            glBindVertexArray(vao);
            glUseProgram(program);
            glBindTexture(GL_TEXTURE_2D, texture);
            glActiveTexture(activeTexture);
            return {};
        }

        bool needsLiveBlur() override {
            return false;
        }
        bool needsPrecomputeBlur() override {
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
        std::optional<CBox> boundingBox() override {
            const auto monitor = m_monitor.lock();
            return monitor ? std::optional<CBox>(CBox{0, 0, monitor->m_size.x, monitor->m_size.y}) : std::nullopt;
        }
        CRegion opaqueRegion() override {
            const auto box = boundingBox();
            return box ? CRegion(*box) : CRegion{};
        }

      private:
        PHLMONITORREF m_monitor;
        SScene        m_scene;
    };

    // Hyprland's own render.pre listener decides whether to blur the glass
    // again, and runs before this one: so once the scene has changed, that
    // decision is made again, by Hyprland's own rule.
    void onPre(PHLMONITOR monitor) {
        if (!g || g->source.empty())
            return;
        auto& state   = g->monitors[monitor->m_id];
        state.pending = readScene(monitor, state);
        if (state.pending == state.drawn)
            return;
        redraw(monitor);
        g_pHyprOpenGL->preRender(monitor);
    }

    void onStage(eRenderStage stage) {
        if (!g || stage != RENDER_POST_WALLPAPER || g->source.empty())
            return;
        const auto monitor = g_pHyprRenderer->m_renderData.pMonitor.lock();
        if (!monitor || !program())
            return;
        auto& state = g->monitors[monitor->m_id];
        state.drawn = state.pending;
        g_pHyprRenderer->m_renderPass.add(makeUnique<CBackdropPass>(monitor, state.pending));
    }

    // The backdrop's own motion. Time stands still while there is nothing to
    // see it on: animations off, the session locked, or every monitor asleep
    // or showing a fullscreen window.
    int onTick(void*) {
        if (!g)
            return 0;
        const auto fps = g->fps->value();
        // At 0 the timer looks again twice a second, for the setting to change.
        wl_event_source_timer_update(g->timer, fps > 0 ? 1000 / fps : 500);
        static auto ANIMATIONS = CConfigValue<Config::INTEGER>("animations:enabled");
        if (fps <= 0 || g->source.empty() || !*ANIMATIONS || g_pSessionLockManager->isSessionLocked())
            return 0;

        const bool glass = ++g->ticks % GLASS_EVERY == 0;
        bool       seen  = false;
        for (const auto& monitor : State::monitorState()->monitors()) {
            if (!monitor->m_enabled || !monitor->m_dpmsStatus || covered(monitor))
                continue;
            seen = true;
            g_pHyprRenderer->damageMonitor(monitor);
            if (glass)
                monitor->m_blurFBDirty = true;
        }
        if (seen)
            g->time = std::fmod(g->time + 1.F / fps, 3600.F);
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
    g->fps    = makeShared<Config::Values::CIntValue>("plugin:backdrop:fps", "Frames a second of the backdrop's own motion; 0 holds it still", 15,
                                                      Config::Values::SIntValueOptions{.min = 0, .max = 120});
    HyprlandAPI::addConfigValueV2(handle, g->fps);
    readTheme();
    claimFadeouts();

    static auto PRE      = Event::bus()->m_events.render.pre.listen([](PHLMONITOR monitor) { onPre(monitor); });
    static auto STAGE    = Event::bus()->m_events.render.stage.listen([](eRenderStage stage) { onStage(stage); });
    static auto CLOSE    = Event::bus()->m_events.window.close.listen([](PHLWINDOW window) {
        if (!g)
            return;
        claimFadeouts();
        g->closing = window->rounding();
    });
    static auto RELOADED = Event::bus()->m_events.config.reloaded.listen([] {
        if (g)
            readTheme();
    });

    g->timer = wl_event_loop_add_timer(g_pCompositor->m_wlEventLoop, onTick, nullptr);
    wl_event_source_timer_update(g->timer, 1000 / 15);

    return {"backdrop", "Draws the current Omarchy theme's backdrop between the wallpaper and the windows.", "Sean", "0.2"};
}

APICALL EXPORT void PLUGIN_EXIT() {
    if (g->timer)
        wl_event_source_remove(g->timer);
    g_pHyprRenderer->m_renderPass.removeAllOfType("CBackdropPass");
    g_pHyprOpenGL->makeEGLCurrent();
    deleteProgram();
    for (const auto& monitor : State::monitorState()->monitors())
        redraw(monitor);
    g.reset();
}
