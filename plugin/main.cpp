// Draws the current Omarchy theme's backdrop between the wallpaper and the
// windows, inside the frame Hyprland is drawing, from the windows' real
// (animated) geometry, so it never trails them.
//
// A theme with a backdrop ships backdrop.frag, a fragment shader written
// against contract.glsl, and loads this plugin from its hyprland.lua. A theme
// switch reloads Hyprland's config: the shader and palette are read again from
// the applied theme then, and a theme that does not load the plugin unloads it.
//
// Hyprland draws a monitor only when something on it changed. Just before it
// decides, the plugin compares what the backdrop would show with what it last
// drew there; if a window moved, the whole monitor is drawn again in that same
// frame. Otherwise the backdrop's own motion asks for frames at plugin:backdrop:fps.

#define WLR_USE_UNSTABLE

#include <hyprland/src/Compositor.hpp>
#include <hyprland/src/config/ConfigValue.hpp>
#include <hyprland/src/config/values/types/IntValue.hpp>
#include <hyprland/src/desktop/Workspace.hpp>
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

using namespace Render::GL;

namespace {

    constexpr int    MAX_WINDOWS = 32; // contract.glsl's windowRects
    // Glass shows the backdrop blurred, where slow motion is invisible, so the
    // glass catches up on every sixth tick and the ticks in between repaint
    // only the backdrop Hyprland shows unblurred.
    constexpr int    GLASS_EVERY = 6;
    constexpr double FOCUS_EASE  = 0.32; // seconds

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

    // What the backdrop shows on one monitor, apart from its own motion.
    struct SScene {
        std::vector<Rect>  rects;
        std::vector<float> alphas;
        int                focusedIndex = -1;
        Rect               focus{};
        bool               operator==(const SScene&) const = default;
    };

    struct SMonitor {
        SScene                                pending; // read just before this frame
        SScene                                drawn;   // last drawn
        PHLWINDOWREF                          focusedWindow;
        Rect                                  focusFrom{};
        std::chrono::steady_clock::time_point focusMoved;
        bool                                  seen = false;
    };

    struct SProgram {
        GLuint id = 0, vao = 0, vbo = 0;
        GLint  proj, resolution, time, accent, background, foreground, focused, rounding, windowCount, windowRects, windowAlpha, focusedIndex;
    };

    struct SState {
        HANDLE                                handle = nullptr;
        std::string                           source; // the theme's shader, empty when it has none
        std::array<float, 3>                  accent{1, 1, 1}, background{0, 0, 0}, foreground{1, 1, 1};
        uint64_t                              generation = 1;
        uint64_t                              compiled   = 0;
        SProgram                              program;
        // Frames a second of the backdrop's own motion; 0 holds it still. 15 by
        // default: on the P16 with Jarvis on workspace 1, idle, it costs about
        // 2.3 W, against 5 W at 30 and 1.6 W at 10 (measured 2026-10-28). Windows
        // are followed every frame whatever this is.
        SP<Config::Values::CIntValue>         fps;
        float                                 time  = 0;
        uint64_t                              ticks = 0;
        wl_event_source*                      timer = nullptr;
        std::unordered_map<MONITORID, SMonitor> monitors;
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
        if (g->program.id)
            glDeleteProgram(g->program.id);
        if (g->program.vbo)
            glDeleteBuffers(1, &g->program.vbo);
        if (g->program.vao)
            glDeleteVertexArrays(1, &g->program.vao);
        g->program = {};
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
        p.rounding     = glGetUniformLocation(p.id, "rounding");
        p.windowCount  = glGetUniformLocation(p.id, "windowCount");
        p.windowRects  = glGetUniformLocation(p.id, "windowRects");
        p.windowAlpha  = glGetUniformLocation(p.id, "windowAlpha");
        p.focusedIndex = glGetUniformLocation(p.id, "focusedIndex");

        // The unit square, as Hyprland's own quads are drawn.
        const std::array<float, 8> quad = {1, 0, 0, 0, 1, 1, 0, 1};
        glGenVertexArrays(1, &p.vao);
        glBindVertexArray(p.vao);
        glGenBuffers(1, &p.vbo);
        glBindBuffer(GL_ARRAY_BUFFER, p.vbo);
        glBufferData(GL_ARRAY_BUFFER, sizeof(quad), quad.data(), GL_STATIC_DRAW);
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
        glBindVertexArray(0);
        glBindBuffer(GL_ARRAY_BUFFER, 0);
        return true;
    }

    float easeOut(float t) {
        return 1.F - std::pow(1.F - t, 3.F);
    }

    // Each window Hyprland will draw on this monitor in this frame, with the
    // box it draws it in, in monitor-local logical pixels.
    template <typename F>
    void forEachWindow(PHLMONITOR monitor, F&& f) {
        for (const auto& w : Desktop::windowState()->windows()) {
            if (!w->m_isMapped || w->isHidden() || !w->m_workspace || !g_pHyprRenderer->shouldRenderWindow(w, monitor))
                continue;
            const auto position = w->position(Desktop::View::IGeometric::GEOMETRIC_CURRENT) + (w->m_pinned ? Vector2D{} : w->m_workspace->m_renderOffset->value()) +
                w->m_floatingOffset - monitor->m_position;
            f(w, CBox{position, w->size(Desktop::View::IGeometric::GEOMETRIC_CURRENT)});
        }
    }

    // The windows on this monitor, where Hyprland draws them this frame, and
    // where attention is.
    SScene readScene(PHLMONITOR monitor, SMonitor& state) {
        SScene     scene;
        const auto focused = Desktop::focusState()->window();
        PHLWINDOW  focusedHere;

        forEachWindow(monitor, [&](const PHLWINDOW& w, const CBox& box) {
            if (std::ssize(scene.rects) == MAX_WINDOWS)
                return;
            if (w == focused) {
                scene.focusedIndex = scene.rects.size();
                focusedHere        = w;
            }
            scene.rects.push_back({float(box.x), float(box.y), float(box.w), float(box.h)});
            scene.alphas.push_back(w->alphaValue(Desktop::View::WINDOW_ALPHA_FADE) * (w->m_pinned ? 1.F : w->m_workspace->m_alpha->value()));
        });

        const Rect middle = {float(monitor->m_size.x * 0.3), float(monitor->m_size.y * 0.3), float(monitor->m_size.x * 0.4), float(monitor->m_size.y * 0.4)};
        const Rect target = scene.focusedIndex < 0 ? middle : scene.rects[scene.focusedIndex];

        // Focus moving to another window eases across; a focused window that
        // moves is followed exactly.
        const auto now = std::chrono::steady_clock::now();
        if (!state.seen) {
            state.seen      = true;
            state.focusFrom = target;
            state.focusMoved = now - std::chrono::seconds(1);
        } else if (state.focusedWindow.lock() != focusedHere) {
            state.focusFrom  = state.drawn.focus;
            state.focusMoved = now;
        }
        state.focusedWindow = focusedHere;

        const float t = std::min(1.F, float(std::chrono::duration<double>(now - state.focusMoved).count() / FOCUS_EASE));
        const float k = easeOut(t);
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

    // Where the backdrop shows unblurred: the monitor minus the tiled windows
    // whose glass comes from Hyprland's cached blur (or that are opaque).
    // Nothing when a window would show the live backdrop through it instead
    // (a floating window blurs what is under it as it is, an unblurred one
    // shows it as it is), since repainting only part of such a window would
    // tear it: then the whole monitor is the answer.
    std::optional<CRegion> unblurred(PHLMONITOR monitor) {
        static auto BLUR          = CConfigValue<Config::INTEGER>("decoration:blur:enabled");
        static auto OPTIMIZATIONS = CConfigValue<Config::INTEGER>("decoration:blur:new_optimizations");
        static auto ROUNDING      = CConfigValue<Config::INTEGER>("decoration:rounding");
        CRegion     region        = CBox{monitor->m_position, monitor->m_size};
        bool        whole         = false;
        forEachWindow(monitor, [&](const PHLWINDOW& w, const CBox& box) {
            // A window asking for blur itself (foot's glass does) gets the
            // cached blur only where it asked for it.
            const auto surface = w->wlSurface();
            const bool asked   = surface && surface->m_hasBackgroundEffect;
            const bool whollyBlurred =
                !asked || CRegion(CBox{{}, box.size()}).subtract(surface->m_blurRegion).empty();
            const bool cached = *BLUR && *OPTIMIZATIONS && !w->m_isFloating && !w->m_ruleApplicator->noBlur().valueOrDefault() &&
                !w->m_ruleApplicator->RGBX().valueOrDefault() && whollyBlurred;
            if (!w->opaque() && !cached)
                whole = true;
            // The rounded corners show what is behind them.
            region.subtract(box.copy().translate(monitor->m_position).expand(-*ROUNDING));
        });
        return whole ? std::nullopt : std::optional<CRegion>(region);
    }

    class CBackdropPass : public IPassElement {
      public:
        CBackdropPass(PHLMONITOR monitor, SScene scene) : m_monitor(monitor), m_scene(std::move(scene)) {}

        std::vector<UP<IPassElement>> draw() override {
            const auto monitor = m_monitor.lock();
            if (!monitor)
                return {};
            auto&      p   = g->program;
            const CBox box = {0, 0, monitor->m_transformedSize.x, monitor->m_transformedSize.y};
            const auto proj = g_pHyprRenderer->projectBoxToTarget(box);

            glUseProgram(p.id);
            glUniformMatrix3fv(p.proj, 1, GL_TRUE, proj.getMatrix().data());
            glUniform2f(p.resolution, monitor->m_size.x, monitor->m_size.y);
            glUniform1f(p.time, g->time);
            glUniform3fv(p.accent, 1, g->accent.data());
            glUniform3fv(p.background, 1, g->background.data());
            glUniform3fv(p.foreground, 1, g->foreground.data());
            glUniform4fv(p.focused, 1, m_scene.focus.data());
            static auto ROUNDING = CConfigValue<Config::INTEGER>("decoration:rounding");
            glUniform1f(p.rounding, float(*ROUNDING));
            glUniform1i(p.windowCount, m_scene.rects.size());
            if (!m_scene.rects.empty()) {
                glUniform4fv(p.windowRects, m_scene.rects.size(), m_scene.rects.front().data());
                glUniform1fv(p.windowAlpha, m_scene.alphas.size(), m_scene.alphas.data());
            }
            glUniform1i(p.focusedIndex, m_scene.focusedIndex);

            glBindVertexArray(p.vao);
            auto& data = g_pHyprRenderer->m_renderData;
            data.damage.forEachRect([&data](const auto& rect) {
                g_pHyprOpenGL->scissor(&rect, data.transformDamage);
                glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
            });
            glBindVertexArray(0);
            g_pHyprOpenGL->scissor(nullptr);
            glUseProgram(0);
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

    void onPreChecks(PHLMONITOR monitor) {
        if (!g || g->source.empty())
            return;
        auto& state   = g->monitors[monitor->m_id];
        state.pending = readScene(monitor, state);
        if (state.pending != state.drawn)
            redraw(monitor);
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
            const auto region = glass ? std::nullopt : unblurred(monitor);
            if (region)
                g_pHyprRenderer->damageRegion(*region);
            else
                redraw(monitor);
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
        HyprlandAPI::addNotification(handle, "[backdrop] built for another Hyprland; run the cinema install again", CHyprColor{1.0, 0.2, 0.2, 1.0}, 15000);
        throw std::runtime_error("[backdrop] version mismatch");
    }

    g         = makeUnique<SState>();
    g->handle = handle;
    g->fps    = makeShared<Config::Values::CIntValue>("plugin:backdrop:fps", "Frames a second of the backdrop's own motion; 0 holds it still", 15,
                                                      Config::Values::SIntValueOptions{.min = 0, .max = 120});
    HyprlandAPI::addConfigValueV2(handle, g->fps);
    readTheme();

    static auto PRECHECKS = Event::bus()->m_events.render.preChecks.listen([](PHLMONITOR monitor) { onPreChecks(monitor); });
    static auto STAGE     = Event::bus()->m_events.render.stage.listen([](eRenderStage stage) { onStage(stage); });
    static auto RELOADED  = Event::bus()->m_events.config.reloaded.listen([] {
        if (g)
            readTheme();
    });

    g->timer = wl_event_loop_add_timer(g_pCompositor->m_wlEventLoop, onTick, nullptr);
    wl_event_source_timer_update(g->timer, 1000 / 15);

    return {"backdrop", "Draws the current Omarchy theme's backdrop between the wallpaper and the windows.", "Sean", "0.1"};
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
