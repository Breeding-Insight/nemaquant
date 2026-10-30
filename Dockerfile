# CPU image - use Dockerfile.gpu for GPU support
FROM python:3.12.13-slim-trixie
# Cache bust: 2026-03-19

# run updates before switching over to non-root user
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# add new user with ID 1000 to avoid permission issues on HF spaces
RUN useradd -m -u 1000 user
USER user

# Set home to user's home dir and add local bin to PATH
# PYTHONPATH is set explicitly so packages are found even when HOME is overridden
# (e.g. by Apptainer --cleanenv, which resets HOME to the host user's home)
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONPATH=/home/user/.local/lib/python3.12/site-packages

# Set the working directory in the container
WORKDIR $HOME/app

# Try and run pip command after setting the user with `USER user` to avoid permission issues with Python
# NOTE - this is from the HF Spaces docs, not sure if necessary
COPY --chown=user ./requirements.txt .
RUN pip install --no-cache-dir torch==2.7.1 torchvision --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir --only-binary :all: -r requirements.txt
# Force headless opencv after ultralytics (which pulls in full opencv-python as a dependency)
RUN pip install --no-cache-dir --force-reinstall opencv-python-headless==4.13.0.92

# Copy the current directory contents into the container at $HOME/app setting the owner to the user
COPY --chown=user . $HOME/app

# Install any needed packages specified in requirements.txt
# --no-cache-dir: Disables the cache to reduce image size.
# -r requirements.txt: Specifies the file containing the list of packages to install.
# RUN pip install --no-cache-dir -r requirements.txt

# Create the necessary dirs
# we should not need to chown, since we are using USER user above
RUN mkdir -p uploads results annotated .yolo_config

# Point YOLO config to /tmp so it is writable under Apptainer (read-only SIF)
# and HF Spaces. /home/user/app/.yolo_config is kept in the image but only used
# as a fallback when the container filesystem is writable (plain Docker).
ENV YOLO_CONFIG_DIR=/tmp/nemaquant/.yolo_config

# Copy the rest of the application code into the container at /app
# This includes app.py, nemaquant.py, templates/, static/, etc.
# COPY . .

# Make port 7860 available to the world outside this container
# This is the port Flask will run on (as configured in app.py)
# Hugging Face Spaces typically uses this port
EXPOSE 7860

# Define environment variables (optional, can be useful)
# ENV NAME=World

# Run app.py when the container launches
# Use gunicorn for production deployment if preferred over Flask's development server
# CMD ["gunicorn", "--bind", "0.0.0.0:7860", "app:app"]
# For simplicity during development and typical HF Spaces use:
CMD ["python", "/home/user/app/app.py"]