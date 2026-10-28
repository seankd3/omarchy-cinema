-- The live backdrop: the plugin draws this theme's backdrop.frag behind the
-- windows. A theme that does not load it unloads it.
hl.plugin.load(os.getenv("HOME") .. "/.local/lib/omarchy-cinema/backdrop.so")

-- Jarvis: every window is glass over the live backdrop. Omarchy's own frosted
-- glass blurs what is behind it; terminals keep Omarchy's rule, since a window
-- rule fades their text, and Glassy mode clears their background instead.
require("default.hypr.glass")()
o.transparent_window(".*", "0.9 0.84")
o.transparent_window({ tag = "terminal" })

-- A theme's own hyprland.lua replaces the one Omarchy renders from
-- colors.toml, so the borders are set here too.
local active_border = { colors = { "rgba(5fd8ffee)", "rgba(ffb347cc)" }, angle = 45 }
local inactive_border = "rgba(1d4566aa)"

hl.config({
  general = {
    col = {
      active_border = active_border,
      inactive_border = inactive_border,
    },
  },

  group = {
    col = {
      border_active = active_border,
      border_inactive = inactive_border,
    },
  },

  -- The windows glow in the reactor's light.
  decoration = {
    shadow = {
      enabled = true,
      range = 22,
      render_power = 3,
      color = "rgba(39c8ff40)",
      color_inactive = "rgba(39c8ff10)",
    },
  },
})
