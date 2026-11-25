#!/bin/sh
# Candidate forced-command helper. Not installed. Target file contains one MAC.
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
TARGET_FILE=/jffs/.growth-island/tv-mac
case "${SSH_ORIGINAL_COMMAND:-}" in status|open) action=$SSH_ORIGINAL_COMMAND;; *) exit 64;; esac
[ -f "$TARGET_FILE" ] || exit 65
mac=$(cat "$TARGET_FILE" | tr 'a-f' 'A-F' | tr -d '\r\n')
printf '%s' "$mac" | grep -Eq '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' || exit 65
mkdir /tmp/growth-island-tv-control.lock 2>/dev/null || exit 75
trap 'rmdir /tmp/growth-island-tv-control.lock 2>/dev/null || :' EXIT HUP INT TERM
macs=$(nvram get MULTIFILTER_MAC)
modes=$(nvram get MULTIFILTER_ENABLE)
global=$(nvram get MULTIFILTER_ALL)
case "$global" in 0|1) :;; *) exit 65;; esac
# Reject incomplete lists, invalid values, absent target and duplicate target.
entry=$(awk -v macs="$macs" -v modes="$modes" -v target="$mac" 'BEGIN {
 n=split(macs,a,">"); if(n!=split(modes,b,">"))exit 1;
 for(i=1;i<=n;i++){if(b[i]!~/^[012]$/)exit 1;if(toupper(a[i])==target){count++;idx=i}}
 if(count!=1)exit 1; for(i=1;i<=n;i++)out=out sprintf("%s%s",i==1?"":">",i==idx?"0":b[i]);
 print b[idx] "|" out
}') || exit 65
mode=${entry%%|*}; new_modes=${entry#*|}
# No targeted drop may remain before reporting a configured rule as open.
check_filter(){
 rules=$(iptables-save) || return 1
 if printf '%s\n' "$rules" | awk -v target="$mac" 'toupper($0) ~ ("--MAC-SOURCE " target) && $0 ~ /-j (DROP|REJECT)( |$)/ {found=1} END {exit !found}'; then return 1; fi
}
if [ "$global" = 0 ] || [ "$mode" = 0 ]; then
 check_filter || exit 69
 printf 'open\n'; exit 0
fi
if [ "$action" = status ]; then printf 'blocked\n'; exit 0; fi
# A fresh check catches intervening edits; this does not provide an atomic CAS
# against concurrent router UI changes, so deployment requires coordination.
[ "$(nvram get MULTIFILTER_MAC)" = "$macs" ] || exit 75
[ "$(nvram get MULTIFILTER_ENABLE)" = "$modes" ] || exit 75
[ "$(nvram get MULTIFILTER_ALL)" = "$global" ] || exit 75
nvram set "MULTIFILTER_ENABLE=$new_modes" >/dev/null
nvram commit >/dev/null
service restart_firewall >/dev/null
[ "$(nvram get MULTIFILTER_ENABLE)" = "$new_modes" ] || exit 69
check_filter || exit 69
printf 'open\n'
