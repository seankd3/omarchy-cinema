-- Oblivion is a film theme: backdrop, glass, borders and glow from film.lua.
-- Frosted white glass: the backdrop under the windows is near white and
-- film.lua keeps a light film's frost bright, so the glass never greys the
-- pane below the white the apps chose their dimmer text against.
dofile(os.getenv("HOME") .. "/.local/lib/omarchy-cinema/film.lua")({ glass = 0.7 })
