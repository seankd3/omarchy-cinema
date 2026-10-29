-- A film theme's Hyprland setup, the same for every film: the live backdrop,
-- every window made of glass, and the film's borders and glow, all taken from
-- the applied theme's colors.toml. A film theme's hyprland.lua calls this with
-- what differs by film:
--
--   glass  how much of a window's background stays, 1 solid to 0 clear (0.85
--          if not given); text and everything else on it stays opaque
--   frost  how far the glass blurs what is behind it, as Hyprland's blur
--          size (3 if not given): fine lettering behind it needs less
--
-- install puts it at ~/.local/lib/omarchy-cinema/film.lua.

local state = os.getenv("XDG_STATE_HOME") or (os.getenv("HOME") .. "/.local/state")

local colors = {}
local file = io.open(state .. "/omarchy/current/theme/colors.toml")
if file then
  for line in file:lines() do
    local key, value = line:match('^%s*([%w_]+)%s*=%s*"(.-)"')
    if key then
      colors[key] = value
    end
  end
  file:close()
end

-- "rgba(a) rgba(b) 45deg" as Hyprland's Lua config takes it, the way Omarchy's
-- own hyprland.lua template writes colors.toml's border gradients.
local function gradient(value)
  local list, angle = {}, nil
  for part in value:gmatch("%S+") do
    local degrees = part:match("^(%-?%d+)deg$")
    if degrees then
      angle = tonumber(degrees)
    else
      list[#list + 1] = part
    end
  end
  if #list == 1 and not angle then
    return list[1]
  end
  return { colors = list, angle = angle or 0 }
end

-- An accent "#rrggbb" as rgba with the given alpha, for the glow.
local function glow(alpha)
  return "rgba(" .. (colors.accent or "#ffffff"):sub(2) .. alpha .. ")"
end

-- A film whose backdrop.frag defines frame() draws each window's edge itself,
-- so Hyprland's border and shadow stand down for it.
local framed = false
local shader = io.open(state .. "/omarchy/current/theme/backdrop.frag")
if shader then
  framed = shader:read("a"):find("vec4%s+frame%s*%(") ~= nil
  shader:close()
end

local active = gradient(colors.hyprland_active_border or ("rgba(" .. (colors.accent or "#ffffff"):sub(2) .. "ee)"))
local inactive = gradient(colors.hyprland_inactive_border or "rgba(595959aa)")

return function(film)
film = film or {}

-- Every window is glass over the backdrop: its background turns to glass and
-- its text stays opaque (Sean, 2026-10-28: "the transparency should effect the
-- background but not the text"). The plugin draws that in Hyprland's window
-- shader at plugin:backdrop:glass, in the version Hyprland uses for windows it
-- blurs, which is the one use_shader_blur_blend selects. Hyprland blurs only
-- behind windows it can see through, so glass windows are 0.999 opaque: no
-- visible fade, but blurred behind. Browsers stay solid (Sean: "except
-- chrome"), as anything at 1 does. Terminals keep their text crisp the same
-- way; Glassy mode clears their background.
require("default.hypr.glass")()
o.transparent_window(".*", "0.999 0.999")
o.transparent_window({ tag = "terminal" }, "0.999 0.999")
o.window({ tag = "chromium-based-browser" }, { opacity = "1 1" })
o.window({ tag = "firefox-based-browser" }, { opacity = "1 1" })

hl.config({
  general = {
    col = { active_border = active, inactive_border = inactive },
    -- Room around and between the windows for the backdrop's light to play in
    -- (Sean, 2026-10-28: "more space between windows and the edge of the
    -- screen to give more breathing room for the effects").
    -- gaps_in is each window's side of the gap, so half of gaps_out makes the
    -- space between windows match the screen's edge. Doubled to 64 (Sean,
    -- 2026-10-28: "increase the panel spacing double it, preportional").
    gaps_out = 64,
    gaps_in = 32,
    border_size = framed and 0 or nil,
  },
  group = { col = { border_active = active, border_inactive = inactive } },
  -- The windows glow in the film's light.
  decoration = {
    shadow = { enabled = not framed, range = 22, render_power = 3, color = glow("40"), color_inactive = glow("10") },
  },
  render = { use_shader_blur_blend = true },
})

-- A light frost: text on the glass is opaque, so nothing behind it competes,
-- and the backdrop's lines should read through (Sean, 2026-10-28: "I don't
-- really see this transparency getting applied"; the heavier 8 x 3 frost had
-- smeared Tron's grid to black). Omarchy's glass toggles load after the theme
-- and set their own, so this is set once the whole config has loaded.
-- Glassy mode also fades Files whole, text included; under a film theme its
-- background turns to glass like every other window's instead.
-- A light film's frost keeps its light: Omarchy's glass dims the blur to 0.75,
-- which on white glass leaves apps' dimmed secondary text under 4.5:1 (Sol,
-- 2026-10-28, Oblivion); a dark film keeps Omarchy's dimming.
local frost = { size = film.frost or 3, passes = 2, brightness = colors.mode == "light" and 1 or nil }
hl.on("config.reloaded", function()
  -- The glass amount is the backdrop plugin's own setting, set here with the
  -- frost: the plugin registers it when it loads, and a build left behind by
  -- a Hyprland update never loads, so an absent key is skipped, not an error.
  if hl.get_config("plugin.backdrop.glass") ~= nil then
    hl.config({ plugin = { backdrop = { glass = film.glass or 0.85 } } })
  end
  hl.config({ decoration = { blur = frost } })
  o.window("org\\.gnome\\.Nautilus", { opacity = "0.999 0.999" })
end)
end
