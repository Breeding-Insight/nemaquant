# Use an official Python runtime as a parent image
FROM python:3.12
# FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

# run updates before switching over to non-root user
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

# add new user with ID 1000 to avoid permission issues on HF spaces
RUN useradd -m -u 1000 user
USER user

# Set home to user's home dir and add local bin to PATH
ENV HOME=/home/user \
    PATH=/user/user/.local/bin:$PATH

# Set the working directory in the container
WORKDIR $HOME/app

# Try and run pip command after setting the user with `USER user` to avoid permission issues with Python
# NOTE - this is from the HF Spaces docs, not sure if necessary
COPY --chown=user ./requirements.txt .
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Copy the current directory contents into the container at $HOME/app setting the owner to the user
COPY --chown=user . $HOME/app

# Install any needed packages specified in requirements.txt
# --no-cache-dir: Disables the cache to reduce image size.
# -r requirements.txt: Specifies the file containing the list of packages to install.
# RUN pip install --no-cache-dir -r requirements.txt

# Create the necessary dirs
# we should not need to chown, since we are using USER user above
RUN mkdir -p .yolo_config

# set the env var for YOLO user config directory
ENV YOLO_CONFIG_DIR=.yolo_config

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
# You could use gunicorn for production deployment if preferred over Flask's development server
# CMD ["gunicorn", "--bind", "0.0.0.0:7860", "app:app"]
# For simplicity during development and typical HF Spaces use:
CMD ["python", "app.py"]