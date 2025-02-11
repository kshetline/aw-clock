#!/bin/bash
if [[ "$1" != "f" ]]; then
  /bin/sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' /home/pi/.config/chromium/Default/Preferences
  /bin/sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' /home/pi/.config/chromium/Default/Preferences
fi

/usr/bin/unclutter -d :0 -idle 30 &

(( n = 0 ))
(( max = 30 ))

until (curl --head --silent --fail http://localhost:8080/ 1> /dev/null 2>&1) || [[ n -ge max ]]; do
  (( n = n + 1 ))
  sleep 1
done

if [[ n -lt max ]]; then
  echo #launch-here
else
  the-browser https://shetline.com/awc-server-error.html
fi
