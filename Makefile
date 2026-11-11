UUID := TorShell@itepo.mx

.PHONY: all schemas lint test pack clean

all: schemas

schemas:
	glib-compile-schemas $(UUID)/schemas

lint:
	npx eslint $(UUID) tests

test:
	GSETTINGS_BACKEND=memory gjs -m tests/test-proxy.js
	gjs -m tests/test-systemd.js

pack: schemas
	gnome-extensions pack --force \
		--schema=schemas/org.gnome.shell.extensions.torshell.gschema.xml \
		--extra-source=torService.js \
		--extra-source=proxy.js \
		--extra-source=indicator.js \
		--extra-source=icons \
		$(UUID)

clean:
	rm -f $(UUID)/schemas/gschemas.compiled
	rm -f $(UUID).shell-extension.zip
