#!/bin/bash

### DOWNLOAD ###

wget -O /tmp/torShell.zip https://github.com/rramirezacosta/torshell/archive/master.zip
unzip /tmp/torShell.zip -d /tmp/torshell_masterdir
rm /tmp/torShell.zip

### DELETE PREVIOUS INSTALATIONS ###
if [ -d "$HOME/.local/share/gnome-shell/extensions/TorShell@itepo.mx" ] 
then
    rm -r $HOME/.local/share/gnome-shell/extensions/TorShell@itepo.mx
fi

### INSTALL NEW ONE ###

mv /tmp/torshell_masterdir/torshell-master/TorShell@itepo.mx $HOME/.local/share/gnome-shell/extensions
rm -rf /tmp/torshell_masterdir/

### ACTIVATE THE EXTENSION IN GNOME-SHEL ###

#disable it (if enabled)
value=$(dconf read /org/gnome/shell/enabled-extensions);
value="${value/\'TorShell@itepo.mx\'/}"
value="${value/, ]/]}"
value="${value/, ,/,}"
dconf write /org/gnome/shell/enabled-extensions "$value"

#enable it
value=${value/]/, \'TorShell@itepo.mx\']}
value="${value/[,/[}"
dconf write /org/gnome/shell/enabled-extensions "$value"


echo "You may have to restart your Gnome-Shell session in order to apply the changes."


