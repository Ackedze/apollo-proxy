#!/usr/bin/env bash
set -euo pipefail
# Local preparation only. The caller publishes the resulting archive/appcast separately.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [[ "$#" != "4" ]]; then
  echo "Usage: prepare-app-update.sh APP_BUNDLE NEW_OUTPUT_DIR HTTPS_RELEASE_ASSET_BASE PRIVATE_EDDSA_KEY_FILE" >&2
  exit 1
fi
APP_BUNDLE="$1"
OUTPUT_DIR="$2"
ASSET_BASE="$3"
KEY_FILE="$4"
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
node -e 'const c=require("node:crypto"),f=require("node:fs"),s=Buffer.from(f.readFileSync(process.argv[1],"utf8").trim(),"base64");if(s.length!==32)throw Error("Expected a 32-byte Sparkle EdDSA seed");const k=c.createPrivateKey({key:Buffer.concat([Buffer.from("302e020100300506032b657004220420","hex"),s]),format:"der",type:"pkcs8"});if(c.createPublicKey(k).export({format:"der",type:"spki"}).subarray(-32).toString("base64")!==process.argv[2])throw Error("Signing key differs from bundled SUPublicEDKey")' "${KEY_FILE}" "${PUBLIC_KEY}"
ARCHIVE_NAME="ApolloProxyControl-macOS-${VERSION}-${BUILD_NUMBER}.zip"
ARCHIVE="${OUTPUT_DIR}/${ARCHIVE_NAME}"
ditto -c -k --norsrc --noextattr --keepParent "${APP_BUNDLE}" "${ARCHIVE}"
SIGNATURE="$("${SIGN_UPDATE}" --ed-key-file "${KEY_FILE}" -p "${ARCHIVE}")"
"${SIGN_UPDATE}" --verify --ed-key-file "${KEY_FILE}" "${ARCHIVE}" "${SIGNATURE}"
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
(out/'PUBLISHING.txt').write_text('Local preparation only; nothing has been published.\nAfter Developer ID signing, notarization and local upgrade acceptance: create the intended GitHub Release, upload the archive and appcast.xml, then verify the configured SUFeedURL serves that appcast. Preserve the EdDSA private key outside the repository and distribution.\n')
print(json.dumps(d))
PY
