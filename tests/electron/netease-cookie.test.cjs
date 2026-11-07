const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { normalizeNeteaseCookieHeader } = require(path.resolve(
  __dirname,
  "../../dist-electron/neteaseCookie.js"
));

test("normalizes QR login cookies for the embedded NetEase server", () => {
  assert.equal(
    normalizeNeteaseCookieHeader("MUSIC_U=value;__csrf=token; NMTID=id"),
    "MUSIC_U=value; __csrf=token; NMTID=id"
  );
});

test("keeps a normalized cookie header stable", () => {
  assert.equal(
    normalizeNeteaseCookieHeader(" MUSIC_U=value; __csrf=token "),
    "MUSIC_U=value; __csrf=token"
  );
});
