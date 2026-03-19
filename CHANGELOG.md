Docker image is versioned based on this file. 
Please, follow the exact format to track versions and updates.
Add new versions on top of olders.

## [0.0.2] - 2026-03-19

### Fixed — Docker image layer compression (Windows compatibility)
- Switched CI build output from `compression=zstd,oci-mediatypes=true` back to default gzip — zstd-compressed layers with OCI media types cause `failed to register layer: invalid tar header` on Windows Docker Desktop and older Apptainer versions regardless of Docker Engine version

### Fixed — Apptainer / Singularity compatibility
- `CMD` now uses absolute path `/home/user/app/app.py` instead of relative `app.py` — Apptainer ignores Docker's `WORKDIR` and used the host's cwd, causing "No such file or directory" on launch
- `PYTHONPATH` baked into image as `/home/user/.local/lib/python3.12/site-packages` — Apptainer `--cleanenv` resets `HOME`, so packages installed under `~/.local` were not found (e.g. `ModuleNotFoundError: No module named 'cv2'`)
- `YOLO_CONFIG_DIR` moved from `/home/user/app/.yolo_config` to `/tmp/nemaquant/.yolo_config` — the SIF container image is read-only under Apptainer, causing repeated "Read-only file system" errors when ultralytics tried to write its cache

### Fixed — Session data lost for large image batches
- Flask client-side cookies are limited to ~4 KB; uploading many images caused `filename_map` and `uuid_map_to_uuid_imgname` to overflow and be silently dropped by the browser, breaking Image Preview and annotation after processing
- Added `_save_session_meta()` / `_load_session_meta()` helpers that persist both maps to `/tmp/nemaquant/sessions/<id>/meta.json`
- All routes (`/preview`, `/annotate`, `/export_images`, `/export_csv`, `/progress`) now fall back to disk if the cookie is empty or missing

### Fixed — `KeyError: 'filename_map'` in `/annotate` and `/export_csv`
- `session['filename_map']` replaced with `session.get('filename_map', {})` throughout — avoids crash when session data is missing after container restart or cookie expiry

### Fixed — Session / cookie issues on HF Spaces (HTTPS proxy)
- Added `FLASK_SECRET_KEY` support: app reads from environment variable so the key is stable across gunicorn workers and restarts; falls back to a random key with a warning
- `SESSION_COOKIE_SECURE=True`, `SESSION_COOKIE_SAMESITE='None'` applied automatically when running on HF Spaces (detected via `SPACE_HOST`/`SPACE_ID` env vars)
- All `fetch()` calls in `static/script.js` now include `credentials: 'include'` so session cookies are forwarded on the HTTPS proxy

### Changed — Runtime directories on HF Spaces / Apptainer
- `uploads/`, `results/`, `annotated/`, `.yolo_config/` moved from the container image layer (`/home/user/app/`) to `/tmp/nemaquant/` — avoids overlay filesystem permission errors on HF Spaces and read-only filesystem errors on Apptainer
- All directories created at app startup with `mkdir(parents=True, exist_ok=True)` so no manual setup is needed

## [0.0.1] - 2026-03-19

- Docker images split by CPU or GPU usage
    - CPU image (`Dockerfile`): ~2.3 GB, based on `python:3.12-slim`
    - GPU image (`Dockerfile.gpu`): ~10 GB, based on `nvidia/cuda:12.8.1-base-ubuntu24.04`
- CPU image uses CPU-only torch wheel (~250 MB vs ~2.5 GB CUDA wheel)
- GPU image uses CUDA 12.8 torch wheel; cuDNN bundled inside torch, no `cudnn-runtime` base needed
- Switched from `opencv-python` to `opencv-python-headless` (server environment, no display needed)
- Force-reinstall `opencv-python-headless` after `ultralytics` to prevent full opencv being pulled as transitive dependency
- Removed unnecessary apt packages (`libgl1`, `libsm6`, `libxrender1`, `libxext6`) — only needed by full opencv
- Fixed `YOLO_CONFIG_DIR` to use absolute path
- Fixed `PATH` to correctly point to `/home/user/.local/bin`
- Updated CI/CD GitHub Actions workflows:
    - `build-images.yml`: builds and pushes both CPU and GPU images to Docker Hub on push to `main`, tagged with version from `CHANGELOG.md` and `latest`
    - `deploy-to-hf.yml`: syncs app files and model weights to Hugging Face Space on push to `main`, using Git LFS for weight files
- Added `update-dockerhub-meta.yml` to make a pretty Dockerhub description based on the `README.md`
- Fixed `uploads/`, `results/`, `annotated/` directories not being created at runtime on HF Spaces — re-enabled `mkdir` calls in `app.py` at startup (HF container filesystem can overlay image build dirs)
