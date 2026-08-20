# Two process types, one image, one database.
#
#   web     serves requests. Set BACKGROUND_JOBS=worker on the app so it does
#           not also run the background loops.
#   worker  runs the background loops (`src/worker.ts`) and nothing else — no
#           HTTP listener, no route manifest, no $PORT.
#
# Scale the worker to at least 1 (`heroku ps:scale worker=1`) *before* setting
# BACKGROUND_JOBS=worker: with neither process running the loops, nothing
# refreshes KeepTradeCut, the league corpus, projections or stat lines, and
# nothing fails to say so. Leaving BACKGROUND_JOBS unset runs them in both,
# which the advisory locks make safe (a skipped tick, not a doubled scrape) but
# which puts the crawler back on the event loop serving requests.
#
# Migrations run on boot in both, so the order they start in does not matter.
# Give each dyno its own share of DATABASE_POOL_MAX — the connection limit that
# matters belongs to the database role, not to any one process.
web: npm start
worker: npm run worker
