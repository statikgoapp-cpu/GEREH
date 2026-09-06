# GEREH Desktop Deploy Standard

## Build machine prerequisites
- Node.js 20 LTS
- Visual Studio Build Tools (Desktop C++ workload)
- Python 3.x
- Poppler (`pdftoppm`) or bundled `desktop/bin/poppler/pdftoppm.exe`
- HQ-SAM checkpoint file (optional but recommended for rhinestone quality)

## HQ-SAM runtime config (optional)
- Place checkpoint file in one of:
  - `models/hq_sam_vit_h.pth`
  - `models/sam_hq_vit_h.pth`
  - or set `HQ_SAM_CHECKPOINT=<absolute-path>`
- Optional env vars:
  - `HQ_SAM_MODEL_TYPE` (default: `vit_h`)
  - `HQ_SAM_DEVICE` (`auto`, `cuda`, `cpu`)
  - `HQ_SAM_PYTHON_BIN` (default: `python`)
  - `HQ_SAM_PYTHON_PATH` (custom HQ-SAM python package path)

## Standard release command
```bash
npm install
npm run desktop:release
```

Output installer:
- `release/GEREH Setup <version>.exe`

License issuer portable EXE:
```bash
npm run license:issuer:build
```
Output:
- `release/license-issuer/GEREH-License-Issuer-<version>.exe`

## What preflight validates
- `dist/index.cjs`, `dist/image-worker.cjs`
- desktop runtime files (`main.cjs`, preloads, license page, icon)
- `call-bind-apply-helpers` presence
- Electron ABI readable
- `better-sqlite3` Electron compatibility smoke check
- `pdftoppm` availability

## Clean install SOP (target PC)
1. Uninstall old GEREH.
2. Delete old install folder if exists:
   - `C:\Program Files\GEREH`
3. Install new setup from `release/GEREH Setup <version>.exe`.
4. (Recommended for GPU inference) run:
   - `script/install-hqsam-runtime.bat`
5. Launch and verify:
   - Pattern upload + vectorization
   - Rhinestone upload + vectorization
   - SVG / DXF / PDF export

## USB handoff package (recommended)
Copy these files to USB:
- `release/GEREH Setup <version>.exe`
- `script/install-hqsam-runtime.bat`

Target PC order:
1. Run setup EXE as admin.
2. Run `install-hqsam-runtime.bat` once (installs Python packages / enables CUDA auto-detect).
3. Open GEREH.

## License UX (offline signed flow)
1. User installs and opens app.
2. Lock screen shows:
   - `Lutfen imzali lisansinizi yukleyin.`
   - `Cihaz Kimliginiz: NP-HID-XXXX`
3. Customer exports request file from lock screen:
   - `Lisans Talebi Disa Aktar`
   - Request includes full `deviceHash` and `deviceId`.
4. You generate signed license offline on your machine:
   - `npm run license:sign-request -- --request <request.json> --private-key <license-private.pem> --customer "Firma A" --out <firma-a.npl>`
5. Activation:
   - User imports signed `.npl`/`.json` file from lock screen (`Lisans Dosyasi Ice Aktar`)
   - Success message: `Imzali lisans aktif edildi.`
6. Optional backup:
   - `Aktif Lisansi Disa Aktar` writes currently active signed license.
7. After activation app opens directly on next launches.
8. Deactivation:
   - `Deaktif Et` button removes local binding and returns to lock screen.

## Professional no-terminal operation
- Field/installer PC:
  - No command needed.
  - Use lock screen buttons only:
    - `USB'den Otomatik Yukle` (recommended)
    - `Lisans Dosyasi Ice Aktar`
    - `Lisans Talebi Disa Aktar`
- Office PC (license issuing):
  - Double click `start-license-issuer.bat` (dev/run mode)
  - Or use built portable issuer EXE:
    - `release/license-issuer/GEREH-License-Issuer-<version>.exe`
  - GUI flow:
    1. `request.json Yukle`
    2. `Private Key Sec`
    3. Fill customer/expiry/features
    4. `Lisans Olustur (.npl)`

## Where to find generated files
- Customer request file:
  - Produced by app lock screen `Lisans Talebi Disa Aktar`
  - You choose save location (usually `Documents`).
- Signed license file (`.npl`):
  - Produced by License Issuer GUI on your office PC
  - You choose save location.
- Public key used by app:
  - `desktop/assets/license-public.pem` (inside project before build).
- Private key (only you):
  - Generated in `license-keys/license-private.pem` (or your chosen secure folder).
- Customer setup installer:
  - `release/GEREH Setup <version>.exe`
- License Issuer portable EXE:
  - `release/license-issuer/GEREH-License-Issuer-<version>.exe`

## First-time key setup (owner machine)
1. Generate key pair:
   - `npm run license:keygen -- --out-dir ./license-keys`
2. Copy public key into app source:
   - `desktop/assets/license-public.pem`
3. Keep `license-private.pem` offline and secret.

## Security rule
- App records `lastSeenAt` on start and on quit.
- If system clock goes backward beyond tolerance, app sets `blockedReason=clock_tamper` and keeps license screen locked.

## Log paths
- Backend log: `%APPDATA%\\rest-express\\logs\\gereh.log`
- Desktop log: `%APPDATA%\\rest-express\\logs\\desktop.log`
