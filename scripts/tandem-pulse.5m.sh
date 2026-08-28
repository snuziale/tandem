#!/bin/sh
#
# <xbar.title>Tandem pulse</xbar.title>
# <xbar.version>v1.0</xbar.version>
# <xbar.desc>Open PRs by whose court the ball is in, served by a running Tandem.</xbar.desc>
# <xbar.dependencies>tandem</xbar.dependencies>
#
# Copy (or symlink) this into your xbar / SwiftBar plugins folder. The whole
# plugin is one curl: Tandem already holds the token, the team, the staleness
# line and the definition of "needs me", so the menu bar reads the SAME pulse
# the app shows instead of keeping a second copy of all four.
#
#   ?view=<id|name>     one saved view (default: the one set in Settings › Pulse)
#   ?team=<id|name>     a team with no saved view behind it
#   ?group=author       group by author / repo / pulse (default: pulse)
#
# The server picks the first free port from 5274, so try the range rather than
# hard-coding one.

QUERY="${TANDEM_PULSE_QUERY:-}"

for port in 5274 5275 5276 5277 5278 5279 5280 5281; do
  body=$(curl -fsS --max-time 8 "http://127.0.0.1:${port}/api/pulse.xbar${QUERY}" 2>/dev/null)
  if [ -n "$body" ]; then
    printf '%s\n' "$body"
    exit 0
  fi
done

# Tandem is not running. Say so quietly — a menu bar that shouts about a closed
# app every five minutes is worse than one that says nothing.
echo "🧑‍💻 —"
echo "---"
echo "Tandem is not running | color=#9ca3af"
echo "Refresh | refresh=true"
