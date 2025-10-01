from PIL import Image

def detect_in_image(model, im_path, conf=0.05):
    img = Image.open(im_path)
    results = model.predict(img, imgsz=1440, max_det=1000, verbose=False, conf=conf)
    result = results[0]
    detections = []
    for i, xyxy in enumerate(result.boxes.xyxy):
        score = float(result.boxes.conf[i])
        class_id = int(result.boxes.cls[i])
        class_name = result.names[class_id]
        if class_name == 'egg':
            detections.append({
                'bbox': [float(x) for x in xyxy.cpu().numpy()],
                'score': score,
                'class': class_name
            })
    return detections
