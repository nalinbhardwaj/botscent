---
'botscent': minor
---

Names Cursor's in-app browser, `cursor-browser`, from the `Cursor/<version>` token in its user agent ([#3](https://github.com/nalinbhardwaj/botscent/issues/3)). Both halves read it: the server half as a declared user-agent token, the page half from `navigator.userAgent`. Like the Codex in-app browser, it identifies the browser, not who acts in it: a person who browses Cursor's browser by hand is reported as `cursor-browser` too.
