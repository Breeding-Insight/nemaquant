---
title: NemaQuant
emoji: 🔬
colorFrom: indigo
colorTo: blue
sdk: docker
dockerfile: Dockerfile.gpu
license: apache-2.0
short_description: "YOLO-based nematode egg detection with real-time processing"
tags:
  - microscopy
  - object-detection
  - yolo
  - biology
  - image-processing
---

# NemaQuant Flask App

A modern web application for automated nematode egg detection and counting using deep learning. This application provides an intuitive interface to process microscope images and identify nematode eggs using the YOLO object detection model.

## Quick Performance Guide
- **Free Tier** (2 vCPU): 100 images ≈ 6-7 minutes
- **CPU Upgrade** ($0.03/hr): 3-4x faster
- **GPU Option** ($0.40/hr): 8-10x faster

Process 500 images for:
- FREE on basic tier (≈ 35 min)
- $0.005 with CPU upgrade (≈ 10 min)
- $0.03 with GPU (≈ 4 min)

## Features

- **Multiple Input Modes**:
  - Single image processing
  - Batch processing of multiple images
  - Directory/folder processing
- **Real-time Progress Tracking**: Monitor processing progress for large batches
- **Interactive Results**:
  - Sortable results table
  - Pagination for large datasets
  - Export functionality for annotated images
- **Flexible Image Support**:
  - Supports PNG, JPG, JPEG, TIF, and TIFF formats
  - Automatic conversion of TIF/TIFF to PNG for web viewing
- **Confidence Threshold Adjustment**: Fine-tune detection sensitivity
- **Batch Export**: Download all annotated images as a ZIP file

## Project Structure

```
/
├── app.py                  # Flask application with REST endpoints and core logic
├── nemaquant.py           # YOLO-based image analysis script
├── requirements.txt       # Python dependencies
├── Dockerfile            # Container configuration
├── README.md            
├── templates/
│   └── index.html        # Modern, responsive web interface
├── static/
│   ├── style.css        # CSS styling
│   └── script.js        # Frontend interactivity and async processing
└── weights.pt           # YOLO model weights (required)
```

## Technical Requirements

- Python 3.11+
- Key Dependencies:
  - Flask = 3.1.1
  - PyTorch = 2.7.1
  - Ultralytics = 8.3.170
  - OpenCV Python = 4.12.0.88
  - Pandas = 2.3.1
  - NumPy = 2.2.6

## Setup and Deployment

### Local Development

1. **Clone the Repository**:
   ```bash
   git clone <repository-url>
   cd nemaquant-flask
   ```

2. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Prepare Model Weights**:
   - Place your `weights.pt` file in the root directory
   - Ensure it's a compatible YOLO model trained for egg detection

4. **Setup Environment**:
   ```bash
   mkdir -p uploads results annotated .yolo_config
   export YOLO_CONFIG_DIR="$PWD/.yolo_config"
   ```

5. **Run the Application**:
   ```bash
   python app.py
   ```
   The application will be available at `http://localhost:7860`

### Container Deployment

1. **Build the Container**:

DEfault image `breedinginsight/nemaquant` is exclusive for **CPU usage**.
For **GPU usage** replace the image by: `breedinginsight/nemaquant:latest-gpu`

- With Docker

   ```bash
   docker pull breedinginsight/nemaquant
   ```


- With Apptainer/Singularity + Slurm from a server:

   ```bash
   # 1) On the login node: pull the image once (creates a .sif file)
   apptainer pull nemaquant_latest.sif docker://breedinginsight/nemaquant:latest

   # 2) Request an interactive compute allocation (adjust for your cluster and analysis)
   salloc -c 4 --mem=16G --time=02:00:00

   # 3) On the compute node shell that opens, run the app on port 7860
   export PORT=7860
   apptainer run --cleanenv --env PORT=$PORT nemaquant_latest.sif
   ```

For **GPU usage** replace the image by: `breedinginsight/nemaquant:latest-gpu`

2. **Run the Container**:

- With Docker

   ```bash
   docker run -p 7860:7860 -v $(pwd)/results:/app/results breedinginsight/nemaquant
   ```

- With Apptainer/Singularity + Slurm from our local computer (after running the above commands on server):

   ```bash
   # Replace user and host with your cluster login node.
   # If your cluster requires a direct tunnel to the compute node, adapt accordingly.
   ssh -L 7860:localhost:7860 [userID]@[yourcluster.address]
   ```

### Hugging Face Spaces Deployment

1. Create a new Space on [Hugging Face](https://huggingface.co/new-space)
2. Select Docker as the SDK
3. Configure the Space:
   - Set app_port to 7860
   - Enable Git LFS for the weights file
4. Push your code:
   ```bash
   git lfs install
   git lfs track "*.pt"
   git add .gitattributes weights.pt
   git add .
   git commit -m "Initial deployment"
   git push
   ```

## Usage

1. **Select Input Mode**:
   - Choose between single image, multiple images, or folder processing
   - For folder mode, ensure images follow the expected structure

2. **Upload Images**:
   - Drag and drop or use the file browser
   - Supported formats: PNG, JPG, JPEG, TIF, TIFF

3. **Configure Processing**:
   - Adjust confidence threshold if needed (default: 0.6)
   - Click "Process Images" to start

4. **View Results**:
   - Monitor real-time progress
   - View detected egg counts in the results table
   - Sort and paginate through results
   - Download annotated images individually or as a batch

## Processing Time & Cost Estimates

### Free Tier (CPU Basic - 2 vCPU, 16GB RAM)
- **Processing Time**:
  - 19 images: ~1:13 (actual measured time)
  - 100 images: ~6-7 minutes
  - 500 images: ~30-35 minutes
- **Cost**: FREE
- **Limitations**: 
  - Slower processing speed
  - 48 hour inactivity timeout
  - Shared resources may affect performance
  - Processing time may increase with server load

### CPU Upgrade Option (8 vCPU, 32GB RAM)
- **Processing Time** (estimated 3-4x faster than free tier):
  - 100 images: ~2 minutes
  - 500 images: ~10 minutes
- **Cost**:
  - $0.03/hour for CPU Upgrade
  - Estimated cost for 100 images: ~$0.001
  - Estimated cost for 500 images: ~$0.005 (0.17 hours * $0.03/hour)

### GPU Options (Optional)
- **Nvidia T4 Small (4 vCPU, 16GB VRAM)**:
  - Processing Time (estimated 8-10x faster than free tier):
    - 100 images: ~45 seconds
    - 500 images: ~4 minutes
  - Cost: $0.40/hour (~$0.01 for 100 images, ~$0.03 for 500 images)

**Note**: These estimates are approximate and may vary based on:
- Image size and complexity
- Server load and availability
- Network conditions for upload/download
- Time of day (free tier performance varies with overall platform usage)

For most users, the free tier is sufficient for small to medium batches (< 200 images), while the CPU upgrade offers a good balance of cost and performance for larger datasets. GPU options are recommended only for time-sensitive processing of large batches or when processing thousands of images.
