-- The Matrix is a film theme: backdrop, glass, borders and glow from film.lua.
-- Clear glass and a light frost, so the rain reads through the windows round
-- the text (Sean, 2026-10-28: "make the backgrounds in the matrix theme more
-- transparent"; the films' usual frost blurred the fine glyphs to black).
-- Secondary text keeps about 5.6:1 over most of the glass (a sample of the
-- rain, 99th percentile).
dofile(os.getenv("HOME") .. "/.local/lib/omarchy-cinema/film.lua")({ glass = 0.2, frost = 1 })
