#!/usr/bin/env bash
set -euo pipefail
# Local preparation only. The caller publishes the resulting archive/appcast separately.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [[ "$#" != "3" && "$#" != "4" ]]; then
  echo "Usage: prepare-app-update.sh APP_BUNDLE NEW_OUTPUT_DIR HTTPS_RELEASE_ASSET_BASE [PRIVATE_EDDSA_KEY_FILE]" >&2
  exit 1
fi
APP_BUNDLE="$1"
OUTPUT_DIR="$2"
ASSET_BASE="$3"
KEY_FILE="${4:-}"
SIGNING_ARGS=(--account "${APOLLO_SPARKLE_KEY_ACCOUNT:-apollo-proxy}")
if [[ -n "${KEY_FILE}" ]]; then SIGNING_ARGS=(--ed-key-file "${KEY_FILE}"); fi
SIGN_UPDATE="${APP_ROOT}/.build/artifacts/sparkle/Sparkle/bin/sign_update"
[[ ! -e "${OUTPUT_DIR}" ]] || { echo "Output already exists." >&2; exit 1; }
codesign --verify --deep --strict "${APP_BUNDLE}"
mkdir -p "${OUTPUT_DIR}"
METADATA="$(python3 - "${APP_BUNDLE}" "${ASSET_BASE}" <<'PY'
import plistlib,sys,urllib.parse
from pathlib import Path
p=plistlib.loads((Path(sys.argv[1])/'Contents/Info.plist').read_bytes())
u=urllib.parse.urlsplit(sys.argv[2]);assert u.scheme=='https' and u.netloc and not u.username and not u.query and not u.fragment
v=p['CFBundleShortVersionString'];b=p['CFBundleVersion'];assert b.isdigit() and all(c.isalnum() or c in '.-+' for c in v)
assert p.get('SUFeedURL') and p.get('SUPublicEDKey')
print(v+' '+b)
PY
)"
read -r VERSION BUILD_NUMBER <<< "${METADATA}"
PUBLIC_KEY="$(/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' "${APP_BUNDLE}/Contents/Info.plist")"
if [[ -z "${KEY_FILE}" ]]; then
  [[ "$(bash "${SCRIPT_DIR}/sparkle-key.sh" public)" == "${PUBLIC_KEY}" ]] || { echo "Keychain key differs from bundled SUPublicEDKey." >&2; exit 1; }
fi
ARCHIVE_NAME="ApolloProxyControl-macOS-${VERSION}-${BUILD_NUMBER}.zip"
ARCHIVE="${OUTPUT_DIR}/${ARCHIVE_NAME}"
ditto -c -k --norsrc --noextattr --keepParent "${APP_BUNDLE}" "${ARCHIVE}"
SIGNATURE="$("${SIGN_UPDATE}" "${SIGNING_ARGS[@]}" -p "${ARCHIVE}")"
"${SIGN_UPDATE}" --verify "${SIGNING_ARGS[@]}" "${ARCHIVE}" "${SIGNATURE}"
node -e 'const c=require("node:crypto"),f=require("node:fs"),p=Buffer.from(process.argv[2],"base64");if(p.length!==32||!c.verify(null,f.readFileSync(process.argv[1]),c.createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),p]),format:"der",type:"spki"}),Buffer.from(process.argv[3],"base64")))throw Error("Archive signature differs from bundled SUPublicEDKey")' "${ARCHIVE}" "${PUBLIC_KEY}" "${SIGNATURE}"
python3 - "${APP_BUNDLE}" "${OUTPUT_DIR}" "${ASSET_BASE}" "${ARCHIVE_NAME}" "${SIGNATURE}" <<'PY'
import datetime,hashlib,json,plistlib,sys,xml.etree.ElementTree as ET
from pathlib import Path
app,out,base,name,sig=sys.argv[1:];out=Path(out);p=plistlib.loads((Path(app)/'Contents/Info.plist').read_bytes())
ns='http://www.andymatuschak.org/xml-namespaces/sparkle';ET.register_namespace('sparkle',ns)
r=ET.Element('rss',{'version':'2.0'});c=ET.SubElement(r,'channel');ET.SubElement(c,'title').text='Apollo Proxy'
i=ET.SubElement(c,'item');ET.SubElement(i,'title').text='Apollo Proxy '+p['CFBundleShortVersionString']
ET.SubElement(i,'{'+ns+'}version').text=p['CFBundleVersion'];ET.SubElement(i,'{'+ns+'}shortVersionString').text=p['CFBundleShortVersionString']
ET.SubElement(i,'{'+ns+'}minimumSystemVersion').text=p['LSMinimumSystemVersion']
a=out/name;ET.SubElement(i,'enclosure',{'url':base.rstrip('/')+'/'+name,'length':str(a.stat().st_size),'type':'application/octet-stream','{'+ns+'}edSignature':sig})
ET.ElementTree(r).write(out/'appcast.xml',encoding='utf-8',xml_declaration=True)
d={'schemaVersion':'apollo.local-app-update.v1','version':p['CFBundleShortVersionString'],'build':p['CFBundleVersion'],'archive':name,'bytes':a.stat().st_size,'sha256':hashlib.sha256(a.read_bytes()).hexdigest(),'feedURL':p['SUFeedURL'],'publicKey':p['SUPublicEDKey'],'published':False}
(out/'release.json').write_text(json.dumps(d,indent=2)+'\n')
(out/'PUBLISHING.txt').write_text('Local preparation only; nothing has been published.\nThis channel uses a permanent local app signing identity and a permanent Sparkle key stored in macOS Keychain. Developer ID and notarization are not required by this release profile; first launch on another Mac may need manual approval.\nAfter local upgrade acceptance and explicit publication authorization: create the intended GitHub Release, upload the archive and appcast.xml, then verify the configured SUFeedURL serves that appcast. Keep both Keychain signing identities; never include private keys in Git or distribution.\n')
print(json.dumps(d))
PY
