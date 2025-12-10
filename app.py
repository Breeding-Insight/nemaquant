import os
import uuid
import traceback
import sys
import time
import io
import zipfile
import cv2
import csv
import pickle
import shutil
import logging
from ultralytics import YOLO
# from ultralytics.utils import ThreadingLocked
import numpy as np
import pandas as pd
from torch import cuda
from flask import Flask, Response, render_template, request, jsonify, send_file, session
from multiprocessing.pool import Pool
from multiprocessing import set_start_method
from pathlib import Path
from PIL import Image
from datetime import datetime
from werkzeug.utils import secure_filename
from yolo_utils import detect_in_image

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', str(uuid.uuid4()))  # For session security

# disable werkzeug logging - too noisy
# comment out these lines if you want to see full logs
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

APP_ROOT = Path(__file__).parent
UPLOAD_FOLDER = APP_ROOT / 'uploads'
RESULTS_FOLDER = APP_ROOT / 'results'
ANNOT_FOLDER = APP_ROOT / 'annotated'
WEIGHTS_FILE = APP_ROOT / 'weights.pt'
app.config['UPLOAD_FOLDER'] = str(UPLOAD_FOLDER)
app.config['RESULTS_FOLDER'] = str(RESULTS_FOLDER)
app.config['ANNOT_FOLDER'] = str(ANNOT_FOLDER)
app.config['WEIGHTS_FILE'] = str(WEIGHTS_FILE)
app.config['ALLOWED_EXTENSIONS'] = {'png', 'jpg', 'jpeg', 'tif', 'tiff'}

# skip these -- created dirs in dockerfile
# UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
# RESULTS_FOLDER.mkdir(parents=True, exist_ok=True)
# ANNOT_FOLDER.mkdir(parents=True, exist_ok=True)

# Load model once at startup, use CUDA if available
MODEL_DEVICE = 'cuda' if cuda.is_available() else 'cpu'

# need a global dict to hold async results objects
# so you can check the progress of an abr
# maybe there's a better way around this?
async_results = {}

@app.errorhandler(Exception)
def handle_exception(e):
    print(f"Unhandled exception: {str(e)}")
    print(traceback.format_exc())
    return jsonify({"error": "Server error", "log": str(e)}), 500

# def allowed_file(filename):
#     return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

@app.route('/')
def index():
    return render_template('index.html')

# save the uploaded files
@app.route('/uploads', methods=['POST'])
def upload_files():
    session_id = session['id']
    files = request.files.getlist('files')
    upload_dir = Path(app.config['UPLOAD_FOLDER']) / session_id
    # clear out any existing files for the session
    if upload_dir.exists():
        shutil.rmtree(upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    # generate new unique filenames via uuid, save the mapping dict of old:new to session
    filename_map = {}
    uuid_map_to_uuid_imgname = {}
    for f in files:
        orig_name = secure_filename(f.filename)
        ext = Path(orig_name).suffix
        uuid_base = uuid.uuid4().hex
        uuid_name = f"{uuid_base}{ext}"
        file_path = upload_dir / uuid_name
        f.save(str(file_path))
        filename_map[uuid_base] = orig_name
        uuid_map_to_uuid_imgname[uuid_base] = uuid_name
    session['filename_map'] = filename_map
    session['uuid_map_to_uuid_imgname'] = uuid_map_to_uuid_imgname
    return jsonify({'filename_map': filename_map, 'status': 'uploaded'})

# /preview route for serving original uploaded image
@app.route('/preview', methods=['POST'])
def preview_image():
    try:
        data = request.get_json()
        uuid = data.get('uuid')
        session_id = session['id']
        uuid_map_to_uuid_imgname = session.get('uuid_map_to_uuid_imgname', {})
        img_name = uuid_map_to_uuid_imgname.get(uuid)
        if not img_name:
            print(f"/preview: No img_name found for uuid {uuid}")
            return jsonify({'error': 'File not found'}), 404
        img_path = Path(app.config['UPLOAD_FOLDER']) / session_id / img_name
        if not img_path.exists():
            print(f"/preview: File does not exist at {img_path}")
            return jsonify({'error': 'File not found'}), 404
        # Determine MIME type
        ext = img_path.suffix.lower()
        if ext in ['.jpg', '.jpeg']:
            mimetype = 'image/jpeg'
        elif ext in ['.png']:
            mimetype = 'image/png'
        elif ext in ['.tif', '.tiff']:
            mimetype = 'image/tiff'
        else:
            mimetype = 'application/octet-stream'
        return send_file(
            str(img_path),
            mimetype=mimetype,
            as_attachment=False,
            download_name=img_name
        )
    except Exception as e:
        print(f"Error in /preview: {e}")
        return jsonify({'error': str(e)}), 500

# initializer for Pool to load model in each process
# each worker will have its own model instance
def init_worker(model_path):
    global model
    model = YOLO(model_path)
    if MODEL_DEVICE == 'cuda':
        model.to('cuda')

# not sure if we need this decorator anymore?
#@ThreadingLocked()
def process_single_image(img_path, results_dir):
    global model
    uuid_base = img_path.stem
    pickle_path = results_dir / f"{uuid_base}.pkl"
    results = detect_in_image(model, str(img_path))
    with open(pickle_path, 'wb') as pf:
        pickle.dump(results, pf)
    return uuid_base

@app.route('/process', methods=['POST'])
def start_processing():
    session_id = session['id']
    job_state = {
        "status": "starting",
        "progress": 0,
        "sessionId": session_id
    }
    session['job_state'] = job_state
    upload_dir = Path(app.config['UPLOAD_FOLDER']) / session_id
    results_dir = Path(app.config['RESULTS_FOLDER']) / session_id
    # clean out old results if needed
    if results_dir.exists():
        shutil.rmtree(results_dir)
    results_dir.mkdir(parents=True)

    # set up iterable of uploaded files to process
    arg_list = [(x,results_dir) for x in list(upload_dir.iterdir())]

    try:
        if MODEL_DEVICE == 'cuda':
            n_proc = 1
        else:
            n_proc = os.cpu_count()
            # Initialize job state
        job_state = {
            "status": "starting",
            "progress": 0,
            "started": True
        }
        session['job_state'] = job_state
        pool = Pool(processes=n_proc,
                  initializer=init_worker,
                  initargs=(str(WEIGHTS_FILE),))
        async_results[session_id] = pool.starmap_async(process_single_image, arg_list)
        pool.close()

        # Update job state after process launch
        job_state["status"] = "processing"
        session['job_state'] = job_state
        return jsonify({'status': 'processing',
                        'sessionId': session_id
                        })
    except Exception as e:
        print(f"Error in /process: {e}")
        print(traceback.format_exc())
        return jsonify({'error': str(e),
                        'status': 'unknown',
                        'sessionId': session_id}), 500
    
@app.route('/progress')
def get_progress():
        session_id = session['id']
        try:
            job_state = session.get('job_state')
            if not job_state:
                print("/progress: No job_state found in session.")
                return jsonify({"status": "error", "error": "No job state"}), 404

            results_dir = Path(app.config['RESULTS_FOLDER']) / session_id
            uploads_dir = Path(app.config['UPLOAD_FOLDER']) / session_id
            n_results = len(list(results_dir.glob('*.pkl')))
            n_uploads = len(list(uploads_dir.iterdir()))

            # If async_result is ready, verify completion and update job state
            async_result = async_results.get(session_id)
            if async_result and async_result.ready():
                if n_results == n_uploads:
                    job_state['status'] = 'completed'
                    job_state['progress'] = 100
                    session['job_state'] = job_state
                    resp = {
                        'status': 'completed',
                        'progress': 100,
                        'filename_map': session.get('filename_map', {}),
                        'session_id': job_state.get('sessionId'),
                        'error': job_state.get('error'),
                    }
                    # Aggregate results into a single response object
                    all_results = {}
                    for pkl_file in results_dir.glob('*.pkl'):
                        uuid_base = pkl_file.stem
                        with open(pkl_file, 'rb') as pf:
                            all_results[uuid_base] = pickle.load(pf)
                    resp['results'] = all_results
                    print(f"Job executed successfully! {len(all_results)} results aggregated.")
                    return jsonify(resp)
                
            # If still processing, update progress
            if job_state.get('status') == 'processing':
                progress = int((n_results / n_uploads) * 100) if n_uploads > 0 else 0
                job_state['progress'] = progress
                session['job_state'] = job_state
                resp = {
                    'status': 'processing',
                    'progress': progress,
                    'sessionId': session_id,
                }
                return jsonify(resp)
            # Default response as a catchall
            resp = {
                'status': job_state.get('status', 'unknown'),
                'progress': job_state.get('progress', 0),
                'sessionId': job_state.get('session_id'),
                'error': job_state.get('error'),
            }
            return jsonify(resp)
        except Exception as e:
            print(f"Error in /progress: {e}")
            print(traceback.format_exc())
            return jsonify({"status": "error", "error": str(e)}), 500

def read_img_and_draw(img_path, detections, confidence):
    img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
    filtered = [d for d in detections if d.get('score', 0) >= confidence]
    for det in filtered:
        x1, y1, x2, y2 = map(int, det['bbox'])
        cv2.rectangle(img, (x1, y1), (x2, y2), (0,0,255), 3)
    return img

# /annotate route for dynamic annotation
@app.route('/annotate', methods=['POST'])
def annotate_image():
    try:
        data = request.get_json()
        uuid = data.get('uuid')
        confidence = float(data.get('confidence', 0.5))
        session_id = session['id']
        uuid_map_to_uuid_imgname = session.get('uuid_map_to_uuid_imgname', {})
        img_name = uuid_map_to_uuid_imgname.get(uuid)
        orig_img_name = session['filename_map'].get(uuid)

        if not img_name:
            return jsonify({'error': 'File not found'}), 404
        # Load detections from pickle
        result_path = Path(app.config['RESULTS_FOLDER']) / session_id / f"{uuid}.pkl"
        if not result_path.exists():
            return jsonify({'error': 'Results not found'}), 404
        with open(result_path, 'rb') as pf:
            detections = pickle.load(pf)

        img_path = Path(app.config['UPLOAD_FOLDER']) / session_id / img_name
        img = read_img_and_draw(img_path, detections, confidence)
        # Save annotated image out
        annot_dir = Path(app.config['ANNOT_FOLDER']) / session_id
        annot_dir.mkdir(parents=True, exist_ok=True)
        annot_imgname = f"{uuid}_annotated.png"
        annot_imgpath = str(annot_dir / annot_imgname)
        cv2.imwrite(annot_imgpath, img)

        # Serve image directly from disk
        return send_file(
            annot_imgpath,
            mimetype='image/png',
            as_attachment=False,
            download_name=annot_imgname
        )
    except Exception as e:
        print(f"Error in /annotate: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/export_images', methods=['POST'])
def export_images():
    try:
        data = request.get_json()
        confidence = float(data.get('confidence', 0.5))
        session_id = session['id']
        filename_map = session.get('filename_map', {})
        uuid_map_to_uuid_imgname = session.get('uuid_map_to_uuid_imgname', {})
        # ensure there's a landing spot
        annot_dir = Path(app.config['ANNOT_FOLDER']) / session_id
        annot_dir.mkdir(parents=True, exist_ok=True)

        # add all annotated files to zip
        memory_file = io.BytesIO()
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            # iterate through all uuids
            for uuid in filename_map.keys():
                img_name = uuid_map_to_uuid_imgname.get(uuid)
                if not img_name:
                    continue
                img_path = Path(app.config['UPLOAD_FOLDER']) / session_id / img_name
                result_path = Path(app.config['RESULTS_FOLDER']) / session_id / f"{uuid}.pkl"
                if not result_path.exists():
                    return jsonify({'error': 'Results not found'}), 404
                if not img_path.exists():
                    return jsonify({'error': 'Image not found'}), 404
                with open(result_path, 'rb') as pf:
                    detections = pickle.load(pf)
                img = read_img_and_draw(img_path, detections, confidence)
                # clean the name
                orig_name = filename_map.get(uuid)
                annot_imgname = f"{str(Path(orig_name).stem)}_annotated.png"
                annot_imgpath = str(annot_dir / annot_imgname)
                cv2.imwrite(annot_imgpath, img)
                zf.write(annot_imgpath, annot_imgname)
        # timestamp for filename
        memory_file.seek(0)
        timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        
        return send_file(
            memory_file,
            mimetype='application/zip',
            as_attachment=True,
            download_name=f'nemaquant_annotated_{timestamp}.zip'
        )

    except Exception as e:
        error_message = f"Error exporting images: {str(e)}"
        print(error_message)
        return jsonify({"error": "Server error", "log": error_message}), 500

@app.route('/export_csv', methods=['POST'])
def export_csv():
    try:
        data = request.json
        session_id = session['id']
        job_state = session.get('job_state')
        filename_map = session.get('filename_map')
        threshold = float(data.get('confidence', 0.5))
        if not job_state:
            return jsonify({'error': 'Job not found'}), 404
        
        # iterate through the results
        results_dir = Path(app.config['RESULTS_FOLDER']) / session_id
        pkl_paths = list(results_dir.glob('*.pkl'))
        all_results = {}
        for path in pkl_paths:
            uuid_base = path.stem
            with open(path, 'rb') as pf:
                all_results[uuid_base] = pickle.load(pf)

        # populate rows for CSV conversion
        rows = []
        for uuid in all_results.keys():
            count = sum(1 for d in all_results[uuid] if d['score'] >= threshold)
            rows.append({'Filename': filename_map[uuid], 'EggsDetected': count, 'ConfidenceThreshold': threshold})
        rows = sorted(rows, key=lambda x: x['Filename'].lower())
        # write the CSV out
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=['Filename', 'EggsDetected', 'ConfidenceThreshold'])
        writer.writeheader()
        writer.writerows(rows)
        output.seek(0)
        return Response(
            output.getvalue(),
            mimetype='text/csv',
            headers={
                'Content-Disposition': f'attachment; filename=nemaquant_results_{timestamp}.csv'
            }
        )
    except Exception as e:
        error_message = f"Error exporting CSV: {str(e)}"
        print(error_message)
        return jsonify({"error": "Server error", "log": error_message}), 500

@app.before_request
def ensure_session():
    if 'id' not in session:
        session['id'] = uuid.uuid4().hex
        print(f"New session started: {session['id']}")
    else:
        pass
        # print(f"Existing session: {session['id']}")


def print_startup_info():
    print("----- NemaQuant Flask App Starting -----")
    print(f"Working directory: {os.getcwd()}")
    python_version_single_line = sys.version.replace('\n', ' ')
    print(f"Python version: {python_version_single_line}")
    print(f"Weights file: {WEIGHTS_FILE}")
    print(f"Weights file exists: {WEIGHTS_FILE.exists()}")
    
    if WEIGHTS_FILE.exists():
        try:
            print(f"Weights file size: {WEIGHTS_FILE.stat().st_size} bytes")
        except Exception as e:
            print(f"Could not get weights file size: {e}")

    is_container = Path('/.dockerenv').exists() or 'DOCKER_HOST' in os.environ
    print(f"Running in container: {is_container}")

    if is_container:
        try:
            user_info = f"{os.getuid()}:{os.getgid()}"
            print(f"User running process: {user_info}")
        except AttributeError:
            print("User running process: UID/GID not available on this OS")
        
        for path_str in ["/app/uploads", "/app/results"]:
            path_obj = Path(path_str)
            if path_obj.exists():
                stat_info = path_obj.stat()
                permissions = oct(stat_info.st_mode)[-3:]
                owner = f"{stat_info.st_uid}:{stat_info.st_gid}"
                print(f"Permissions for {path_str}: {permissions}")
                print(f"Owner for {path_str}: {owner}")
            else:
                print(f"Directory {path_str} does not exist.")

    # some cleanup steps - not sure quite where to put these
    print('Running periodic cleanup of old sessions...')
    # Cleanup old session folders
    max_age_hours = 4
    now = time.time()
    for base_dir in [UPLOAD_FOLDER, RESULTS_FOLDER, ANNOT_FOLDER]:
        for session_dir in Path(base_dir).iterdir():
            if session_dir.is_dir():
                mtime = session_dir.stat().st_mtime
                if now - mtime > max_age_hours * 3600:
                    shutil.rmtree(session_dir)
    
    print('App is running at the following local addresses:',
          'http://127.0.0.1:7860⁠',
          'http://localhost:7860⁠',
          sep='\n')

if __name__ == '__main__':
    print_startup_info()
    app.run(host='0.0.0.0', port=7860, debug=True)