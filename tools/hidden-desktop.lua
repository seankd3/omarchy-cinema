-- The hidden desktop's session (tools/hidden-desktop): the user's own
-- ~/.config/hypr/hyprland.lua, as a login loads it, so the engine loads by
-- the lines ./install put there, without the services a login starts.
-- Omarchy's shell comes once D-Bus has the desktop's environment, so
-- tools/hidden-desktop starts it; Omarchy's autostart (idle, hooks, udiskie,
-- herdr) and the user's stay out, so the command starts everything else, and
-- the user's monitors give way to the hidden screen.

-- Preloaded, since Omarchy's bootstrap clears package.loaded of its modules.
package.preload["default.hypr.autostart"] = function() return true end
package.preload["hypr.autostart"] = function() return true end
dofile(os.getenv("HOME") .. "/.config/hypr/hyprland.lua")

-- The screen is frameclock's window, and the pointer it never has is not
-- drawn.
hl.monitor({ output = "WAYLAND-1", mode = "preferred", position = "0x0", scale = tonumber(os.getenv("HIDDEN_DESKTOP_SCALE")) })
hl.config({ cursor = { invisible = true } })
