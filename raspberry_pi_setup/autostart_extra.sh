#!/bin/bash
/bin/sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' /home/pi/.config/chromium/Default/Preferences
/bin/sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' /home/pi/.config/chromium/Default/Preferences
/usr/bin/unclutter -d :0 -idle 30

until curl --head --silent --fail http://localhost:8080/ 1> /dev/null 2>&1; do
  sleep 1
done
