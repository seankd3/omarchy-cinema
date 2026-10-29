-- Jurassic Park is a film theme: backdrop, glass, borders and glow from film.lua.
-- Clear glass, so fsn's landscape reads through the windows; the backdrop
-- dims it there, and secondary text keeps 4.9:1 or better over it.
dofile(os.getenv("HOME") .. "/.local/lib/omarchy-cinema/film.lua")({ glass = 0.4 })
