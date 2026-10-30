-- The hidden desktop's session (tools/hidden-desktop): Sean's Hyprland setup,
-- as ~/.config/hypr/hyprland.lua loads it, without the services a login
-- starts. Omarchy's defaults with the applied theme, the backdrop plugin
-- ./install put in place, his own input, bindings and look, and his toggles.
-- Omarchy's shell comes once D-Bus has the desktop's environment, so
-- tools/hidden-desktop starts it; Omarchy's autostart (idle, hooks, udiskie,
-- herdr) and his (omarchy-resume) stay out, so the command starts everything
-- else, and his monitors give way to the hidden screen.

dofile(os.getenv("OMARCHY_PATH") .. "/default/hypr/bootstrap.lua")
hl.plugin.load(os.getenv("HOME") .. "/.local/lib/omarchy-cinema/backdrop.so")
package.loaded["default.hypr.autostart"] = true
require("default.hypr.omarchy")
local optional = require("default.hypr.require_optional")
optional.module("hypr.input")
optional.module("hypr.bindings")
optional.module("hypr.looknfeel")
require("default.hypr.toggles")

-- The screen is frameclock's window, and the pointer it never has is not
-- drawn.
hl.monitor({ output = "WAYLAND-1", mode = "preferred", position = "0x0", scale = tonumber(os.getenv("HIDDEN_DESKTOP_SCALE")) })
hl.config({ cursor = { invisible = true } })
