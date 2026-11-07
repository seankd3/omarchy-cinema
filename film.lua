-- The film themes' Hyprland setup, the same for every film: every window made
-- of glass over the live backdrop, room round the windows and the film's glow.
-- ~/.config/hypr/hyprland.lua calls it on every config load, just after
-- Omarchy's defaults, where a theme's own hyprland.lua would run, so the
-- user's config and Omarchy's toggles still come after it. A theme with no
-- backdrop.frag is not a film, and gets nothing from it. A film theme then
-- holds no Lua, which `omarchy theme install` drops: its borders come from
-- Omarchy's own template, and what differs by film is in its colors.toml:
--
--   glass  how much of a window's background stays, 1 solid to 0 clear (0.85
--          if not given); text and everything else on it stays opaque. The
--          backdrop plugin reads it with the theme.
--   frost  how far the glass blurs what is behind it, as Hyprland's blur
--          size (3 if not given): fine lettering behind it needs less
--
-- It is installed with the plugin (plugin/Makefile's install: the package in
-- /usr/lib/omarchy-cinema, ./install in ~/.local/lib/omarchy-cinema).

local theme = (os.getenv("XDG_STATE_HOME") or (os.getenv("HOME") .. "/.local/state")) .. "/omarchy/current/theme"

return function()
local shader = io.open(theme .. "/backdrop.frag")
if not shader then
  return
end
shader:close()

local colors = {}
local file = io.open(theme .. "/colors.toml")
if file then
  for line in file:lines() do
    local key, value = line:match('^%s*([%w_]+)%s*=%s*"(.-)"')
    if key then
      colors[key] = value
    end
  end
  file:close()
end

-- An accent "#rrggbb" as rgba with the given alpha, for the glow.
local function glow(alpha)
  return "rgba(" .. (colors.accent or "#ffffff"):sub(2) .. alpha .. ")"
end

-- Every window is glass over the backdrop: its background turns to glass and
-- its text stays opaque. The plugin draws that in Hyprland's window
-- shader at the theme's glass, in the version Hyprland uses for windows it
-- blurs, which is the one use_shader_blur_blend selects. Hyprland blurs only
-- behind windows it can see through, so glass windows are 0.999 opaque: no
-- visible fade, but blurred behind. Browsers stay solid, as anything at 1
-- does. Terminals keep their text crisp the same
-- way; Glassy mode clears their background.
require("default.hypr.glass")()
o.transparent_window(".*", "0.999 0.999")
o.transparent_window({ tag = "terminal" }, "0.999 0.999")
o.window({ tag = "chromium-based-browser" }, { opacity = "1 1" })
o.window({ tag = "firefox-based-browser" }, { opacity = "1 1" })

-- Room around and between the windows for the backdrop's light to play in,
-- in proportion to the screen: 64 px for each 1440 of the smallest screen's
-- shorter side, the side a column of windows runs out of (64 at 2304x1440,
-- 48 at 1920x1080, 34 at 1366x768).
local function room()
  local short
  for _, m in ipairs(hl.get_monitors()) do
    local side = math.min(m.width, m.height) / m.scale
    short = math.min(short or side, side)
  end
  return math.floor((short or 1440) * 64 / 1440 + 0.5)
end
local gaps = room()
-- Which gaps are still film.lua's: none of the config after it has set them.
local ours = { gaps_out = true, gaps_in = true }
-- gaps_in is each window's side of the gap, so half of gaps_out makes the
-- space between windows match the screen's edge.
local function space(config)
  config({ general = { gaps_out = ours.gaps_out and gaps or nil, gaps_in = ours.gaps_in and gaps // 2 or nil } })
end
space(hl.config)

-- Hyprland loads its config before it knows its screens, so the gaps that are
-- still film.lua's follow the screens as they come and change. The user's
-- config, the toggles and anything later set gaps through hl.config, which
-- notes it; Lua starts afresh at every load, and so does this.
local config = hl.config
function hl.config(values)
  local general = type(values) == "table" and values.general
  if type(general) == "table" then
    ours.gaps_out = ours.gaps_out and general.gaps_out == nil
    ours.gaps_in = ours.gaps_in and general.gaps_in == nil
  end
  return config(values)
end
hl.on("monitor.layout_changed", function()
  if room() ~= gaps then
    gaps = room()
    space(config)
  end
end)

hl.config({
  -- The windows glow in the film's light.
  decoration = {
    shadow = { enabled = true, range = 22, render_power = 3, color = glow("40"), color_inactive = glow("10") },
  },
  render = { use_shader_blur_blend = true },
})
-- A light frost: text on the glass is opaque, so nothing behind it competes,
-- and the backdrop's lines should read through (the heavier 8 x 3 frost
-- smeared Tron's grid to black). Omarchy's glass toggles load after the theme
-- and set their own, so this is set once the whole config has loaded.
-- Glassy mode also fades Files whole, text included; under a film theme its
-- background turns to glass like every other window's instead.
-- A light film's frost keeps its light: Omarchy's glass dims the blur to 0.75,
-- which on white glass leaves apps' dimmed secondary text under 4.5:1
-- (Oblivion); a dark film keeps Omarchy's dimming.
local frost = { size = tonumber(colors.frost) or 3, passes = 2, brightness = colors.mode == "light" and 1 or nil }
hl.on("config.reloaded", function()
  hl.config({ decoration = { blur = frost } })
  o.window("org\\.gnome\\.Nautilus", { opacity = "0.999 0.999" })
  -- A shell surface's card is glass like a window's, frosted from the
  -- windows' frost, the one the backdrop makes; its scrim stays a plain dim
  -- over the screen. The shell draws its cards 0.95 to 1 opaque and its
  -- scrims 0.5, and a layer's ignore_alpha is the line: the plugin's glass and
  -- frost go only where the app's own alpha is above it (Omarchy's 0.3, set
  -- after the theme, would frost the scrims). Without xray Hyprland blurs a
  -- layer live, from the screen, every frame it draws: not the film's frost,
  -- and the world drawn again under it (specs/smoothness.md, "Frame budget").
  hl.layer_rule({ match = { namespace = ".*" }, xray = true, ignore_alpha = 0.75 })
  -- Every surface of Omarchy's shell is glass, as every window is, also those
  -- Glassy mode's list leaves out (the launcher). Its wallpaper is not: a
  -- bottom or background layer always blurs live (#11).
  hl.layer_rule({ match = { namespace = "^omarchy-.*" }, blur = true })
  hl.layer_rule({ match = { namespace = "^omarchy-background$" }, blur = false })
end)
end
