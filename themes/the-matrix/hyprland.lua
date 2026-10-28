-- The Matrix is a film theme: backdrop, glass, borders and glow from film.lua.
-- Clear glass, so the rain reads through the windows round the text (Sean,
-- 2026-10-28: "make the backgrounds in the matrix theme more transparent"):
-- at 0.3 secondary text keeps about 6:1 over most of the glass (a sample of
-- the rain, 99th percentile), and 4-5.4:1 at the brightest pixels, which sit
-- at a window's edge.
dofile(os.getenv("HOME") .. "/.local/lib/omarchy-cinema/film.lua")({ glass = 0.3 })
