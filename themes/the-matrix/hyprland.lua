-- The Matrix is a film theme: backdrop, glass, borders and glow from film.lua.
-- Clear glass, so the rain reads through the windows round the text (Sean,
-- 2026-10-28: "make the backgrounds in the matrix theme more transparent"):
-- at 0.3 secondary text keeps 6:1 over the glass, dipping to about 4.2:1 only
-- while a head passes right behind it.
dofile(os.getenv("HOME") .. "/.local/lib/omarchy-cinema/film.lua")({ glass = 0.3 })
