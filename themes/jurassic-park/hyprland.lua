-- Jurassic Park is a film theme: backdrop and glass from film.lua. Its
-- backdrop draws each window's IRIX bevel (frame()), so film.lua turns
-- Hyprland's border and glow off for it.
-- Clear glass, so fsn's landscape reads through the windows; the backdrop
-- dims it there, and secondary text keeps 4.9:1 or better over it.
dofile(os.getenv("HOME") .. "/.local/lib/omarchy-cinema/film.lua")({ glass = 0.4 })
