-- Oblivion is a film theme: backdrop, glass, borders and glow from film.lua.
-- Frosted white glass over the sky, kept fairly solid: Omarchy's frost dims
-- what shows through it, so in a light theme every bit of glass greys the
-- pane and lowers the contrast the apps chose for their dimmer text.
dofile(os.getenv("HOME") .. "/.local/lib/omarchy-cinema/film.lua")({ glass = 0.8 })
