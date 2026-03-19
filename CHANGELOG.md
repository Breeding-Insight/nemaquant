Docker image is versioned based on this file. 
Please, follow the exact format to track versions and updates.
Add new versions on top of olders.

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