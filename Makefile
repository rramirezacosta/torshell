UUID := TorShell@itepo.mx
POT := po/torshell.pot
PO_FILES := $(wildcard po/*.po)

.PHONY: all schemas lint pot update-po check-po test pack clean

all: schemas

schemas:
	glib-compile-schemas $(UUID)/schemas

lint:
	npx eslint $(UUID) tests

pot:
	xgettext --from-code=UTF-8 --language=JavaScript --add-comments \
		--keyword=_ --keyword=ngettext:1,2 --keyword=pgettext:1c,2 \
		--package-name=TorShell --output=$(POT) $(UUID)/*.js

update-po: pot
	@for po in $(PO_FILES); do msgmerge --update --backup=none $$po $(POT); done

check-po:
	@for po in $(PO_FILES); do msgfmt --check -o /dev/null $$po; done

test: check-po
	GSETTINGS_BACKEND=memory gjs -m tests/test-proxy.js
	gjs -m tests/test-systemd.js
	gjs -m tests/test-polkit-rule.js

pack: schemas
	gnome-extensions pack --force \
		--schema=schemas/org.gnome.shell.extensions.torshell.gschema.xml \
		--podir=$(CURDIR)/po \
		--extra-source=torService.js \
		--extra-source=torControl.js \
		--extra-source=proxy.js \
		--extra-source=indicator.js \
		--extra-source=quickToggle.js \
		--extra-source=polkitRule.js \
		--extra-source=icons \
		$(UUID)

clean:
	rm -f $(UUID)/schemas/gschemas.compiled
	rm -f $(UUID).shell-extension.zip
