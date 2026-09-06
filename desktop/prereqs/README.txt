Place optional prerequisite installers in this folder.

Supported optional files:
- vc_redist.x64.exe
- driver-setup.exe
- install-prereqs.cmd
- python-installer.exe (optional alias for Python installer)
- python-3.12.10-amd64.exe (optional direct Python installer name)

Behavior during setup:
- If a file exists, installer will run it silently.
- If a file does not exist, installer skips it.
- If an installer exits with non-zero code, setup continues.

Recommended:
- Keep install-prereqs.cmd idempotent (safe to run multiple times).
- Use silent switches in custom installers.

Quick usage:
1) Put Microsoft VC++ runtime installer as:
   - vc_redist.x64.exe
2) Put your serial/USB driver installer (if needed) as:
   - driver-setup.exe
3) Put Python installer as one of:
   - python-installer.exe
   - python-3.12.10-amd64.exe
4) Run:
   - npm run desktop:release
