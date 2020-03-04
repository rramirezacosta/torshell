#!/bin/bash


#disable it (if enabled)
value=$(dconf read /org/gnome/shell/enabled-extensions);
value="${value/\'TorShell@itepo.mx\'/}"
value="${value/, ]/]}"
value="${value/, ,/,}"
dconf write /org/gnome/shell/enabled-extensions "$value"

### DELETE PREVIOUS INSTALATIONS ###
if [ -d "$HOME/.local/share/gnome-shell/extensions/TorShell@itepo.mx" ] 
then
    rm -r $HOME/.local/share/gnome-shell/extensions/TorShell@itepo.mx
fi

echo "TorShell Uninstalled"
