#!/bin/bash
# Dobbeltklik denne fil for at starte appen lokalt på din Mac.
cd "$(dirname "$0")"
PORT=5173
echo "Starter Danmark · 100 Seværdigheder på http://localhost:$PORT ..."
# Åbn browseren lidt efter serveren er oppe
( sleep 1; open "http://localhost:$PORT/index.html" ) &
python3 -m http.server $PORT
