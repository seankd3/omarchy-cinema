-- A film theme's Hyprland setup, the same for every film: the live backdrop,
-- every window made of glass, and the film's borders and glow, all taken from
-- the applied theme's colors.toml. A film theme's hyprland.lua is one dofile
-- of this. install puts it at ~/.local/lib/omarchy-cinema/film.lua.

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

local active = gradient(colors.hyprland_active_border or ("rgba(" .. (colors.accent or "#ffffff"):sub(2) .. "ee)"))
local inactive = gradient(colors.hyprland_inactive_border or "rgba(595959aa)")

-- The plugin draws the theme's backdrop.frag behind the windows. A theme that
-- does not load it unloads it.
hl.plugin.load(os.getenv("HOME") .. "/.local/lib/omarchy-cinema/backdrop.so")

-- Every window is glass over the backdrop, through Omarchy's own frosted glass.
-- Terminals keep Omarchy's rule, since a window rule fades their text, and
-- Glassy mode clears their background instead. 0.95 and 0.92 keep text near
-- full brightness (Sean, 2026-10-28: "the text is a bit dark").
require("default.hypr.glass")()
o.transparent_window(".*", "0.95 0.92")
o.transparent_window({ tag = "terminal" })

hl.config({
  general = { col = { active_border = active, inactive_border = inactive } },
  group = { col = { border_active = active, border_inactive = inactive } },
  -- The windows glow in the film's light.
  decoration = {
    shadow = { enabled = true, range = 22, render_power = 3, color = glow("40"), color_inactive = glow("10") },
  },
})

-- Over a moving backdrop Omarchy's light frost leaves text behind the glass
-- legible enough to fight the text on it, so the frost is heavier. Omarchy's
-- glass toggles load after the theme and set their own, so this is set once
-- the whole config has loaded.
hl.on("config.reloaded", function()
  hl.config({ decoration = { blur = { size = 8, passes = 3 } } })
end)
