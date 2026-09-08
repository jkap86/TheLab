# Heroku process types. `APP_PROCESS_ROLE` decides which of the two jobs a
# process does — serve requests, run the background loops, or both — and it is
# read by `src/shared/util/process-role.ts`. See "Deploying" in README.md.
#
# INITIAL SINGLE-DYNO DEPLOYMENT — one $7 Basic dyno, 512 MB:
#
#   heroku ps:scale web=1 worker=0
#
#   With no `APP_PROCESS_ROLE` config var set, the web line below runs as
#   `all`, so this dyno serves requests *and* runs the league crawler, the KTC
#   refresh, the Sleeper players refresh and the comps corpus check. The
#   crawler's RSS guard is what keeps them out of a reader's way: it narrows
#   and then stops the crawl as memory rises, on the rule that background
#   freshness is opportunistic and user-facing traffic is not — see
#   `shared/manager/crawl-pressure.ts`.
#
# LATER SPLIT DEPLOYMENT — a dyno each, no redeploy needed:
#
#   heroku config:set APP_PROCESS_ROLE=web
#   heroku ps:scale web=1 worker=1
#
#   Do both in one change. A web dyno left on `all` beside a running worker is
#   two processes doing the same maintenance; they stay *correct* — every loop
#   takes a Postgres advisory lock per tick and stands down when another
#   instance holds it — but the point of the split is to get that work off the
#   dyno serving requests, and a duplicated crawl gets none of it.
#
# **The two lines read the variable differently, and that asymmetry is the
# whole mechanism.** The web line takes it as a default (`:-all`), so a config
# var overrides it and one `heroku config:set` moves this deployment from the
# single dyno to the split without touching the repo. The worker line assigns
# it outright, so the same config var — which Heroku applies to *every* dyno —
# cannot tell the worker it is a web process: a shell assignment in front of a
# command wins over the inherited environment.
web: APP_PROCESS_ROLE=${APP_PROCESS_ROLE:-all} npm run start
worker: APP_PROCESS_ROLE=worker npm run worker
