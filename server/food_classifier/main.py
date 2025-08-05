import io
from fastapi import UploadFile
import torch
import torchvision.transforms as transforms
from torchvision import datasets
from torch.utils.data import DataLoader

import matplotlib.pyplot as plt
import numpy as np

import torch.nn as nn
import torch.optim as optim
import random

from pathlib import Path
from PIL import Image

from rembg import remove



from torchvision.models import resnet50, ResNet50_Weights


def create_net(num_classes=10):
    net = resnet50(weights=ResNet50_Weights.IMAGENET1K_V1)
    net.fc = nn.Linear(net.fc.in_features, num_classes)
    return net




def imshow_batch(images, labels, predictions=None, class_names=None, title="Batch Visualization"):
    """Display a batch of images with labels and optional predictions"""
    fig, axes = plt.subplots(2, 4, figsize=(15, 8))
    axes = axes.ravel()
    
    for idx in range(min(8, len(images))):
        # Unnormalize the image for ImageNet stats
        img = images[idx] * torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1) + torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
        img = torch.clamp(img, 0, 1)
        npimg = img.numpy()
        
        axes[idx].imshow(np.transpose(npimg, (1, 2, 0)))
        
        # Create title with true label and prediction
        if class_names:
            true_label = class_names[labels[idx]]
            if predictions is not None:
                pred_label = class_names[predictions[idx]]
                color = 'green' if predictions[idx] == labels[idx] else 'red'
                axes[idx].set_title(f'True: {true_label}\nPred: {pred_label}', 
                                  fontsize=10, color=color)
            else:
                axes[idx].set_title(f'True: {true_label}', fontsize=10)
        else:
            if predictions is not None:
                color = 'green' if predictions[idx] == labels[idx] else 'red'
                axes[idx].set_title(f'True: {labels[idx]}\nPred: {predictions[idx]}', 
                                  fontsize=10, color=color)
            else:
                axes[idx].set_title(f'True: {labels[idx]}', fontsize=10)
        
        axes[idx].axis('off')
    
    # Hide unused subplots
    for idx in range(len(images), 8):
        axes[idx].axis('off')
    
    plt.suptitle(title, fontsize=16)
    plt.tight_layout()
    plt.show()



def process_upload_file(upload_file: UploadFile):
    """
    Process an UploadFile and return a PIL Image
    """
    try:
        # Reset file pointer to beginning first
        upload_file.file.seek(0)
        
        # Read the file content
        image_data = upload_file.file.read()
        
        # Check if we actually got data
        if not image_data:
            raise ValueError("No image data received - file appears to be empty")
        
        print(f"Read {len(image_data)} bytes from uploaded file")
        
        # Create PIL Image from bytes
        image_bytes = io.BytesIO(image_data)
        image = Image.open(image_bytes).convert('RGB')
        
        print(f"Successfully loaded image: {image.size}, mode: {image.mode}")
        
        # Reset file pointer for potential reuse
        upload_file.file.seek(0)
        
        return image
        
    except Exception as e:
        print(f"Error processing upload file: {e}")
        print(f"File info - filename: {upload_file.filename}, content_type: {getattr(upload_file, 'content_type', 'unknown')}")
        if hasattr(upload_file, 'size'):
            print(f"File size: {upload_file.size}")
        raise

def preprocess_image_for_inference(image: Image.Image, device):
    """
    Preprocess a PIL Image for model inference
    """
    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))
    ])
    
    image_tensor = transform(image).unsqueeze(0)  # Add batch dimension
    return image_tensor.to(device)



def load_image(path: str) -> Image.Image:
    return Image.open(path).convert("RGBA")


def get_relative_path() -> Path:
    return str(Path(__file__).resolve().parent)
    

def add_white_background(img: str) -> Image.Image:
    img_str = img
    img = load_image(img)
    print("the add white background thing got invoked")
    white_bg = Image.new("RGB", img.size, (255, 255, 255))
    white_bg.paste(img, mask=img.split()[3])  # use alpha channel as mask
    
    image_path = get_relative_path() + "image.jpg"
    
    save_image(white_bg, image_path)  # Save the modified image, not the original
    remove_background(img, img_str)
    return white_bg


def remove_background(input_image: Image.Image, output_path: str):
    # input_image is already an Image, no need to open
    output_image = remove(input_image)  # background removed, transparent BG
    
    white_bg = Image.new("RGB", output_image.size, (255, 255, 255))
    white_bg.paste(output_image, mask=output_image.split()[3])
    
    
    white_bg.save(output_path)



def save_image(img: Image.Image, path: str) -> None:
    print("saved the image file")
    # Convert to RGB before saving as JPEG to remove alpha channel
    if path.lower().endswith((".jpg", ".jpeg")) and img.mode == "RGBA":
        img = img.convert("RGB")
    img.save(path)



def run_inference(image_input, model, verbose=True, num_classes=206):
    """
    Run inference on an image input
    
    Args:
        image_input: Can be UploadFile, file path (str/Path), PIL Image, or tensor
        model_path: Path to the saved model weights
        num_classes: Number of classes in the model
    
    Returns:
        str: Predicted class name
    """
    
    classnames = ['Apple 10', 'Apple 11', 'Apple 12', 'Apple 13', 'Apple 14', 'Apple 17', 'Apple 18', 'Apple 19', 'Apple 5', 'Apple 6', 'Apple 7', 'Apple 8', 'Apple 9', 'Apple Braeburn 1', 'Apple Core 1',
                  
    'Apple Crimson Snow 1', 'Apple Golden 1', 'Apple Golden 2', 'Apple Golden 3', 'Apple Granny Smith 1', 'Apple Pink Lady 1', 'Apple Red 1', 'Apple Red 2', 'Apple Red 3', 'Apple Red Delicious 1', 
    'Apple Red Yellow 1', 'Apple Red Yellow 2', 'Apple Rotten 1', 'Apple hit 1', 'Apple worm 1', 'Apricot 1', 'Avocado 1', 'Avocado Black 1', 'Avocado Green 1', 'Avocado ripe 1', 'Banana 1', 'Banana 3', 
    'Banana 4', 'Banana Lady Finger 1', 'Banana Red 1', 'Beans 1', 'Beetroot 1', 'Blackberrie 1', 'Blackberrie 2', 'Blackberrie half rippen 1', 'Blackberrie not rippen 1', 'Blueberry 1', 'Cabbage red 1', 
    'Cabbage white 1', 'Cactus fruit 1', 'Cactus fruit green 1', 'Cactus fruit red 1', 'Caju seed 1', 'Cantaloupe 1', 'Cantaloupe 2', 'Carambula 1', 'Carrot 1', 'Cauliflower 1', 'Cherimoya 1', 'Cherry 1',
    'Cherry 2', 'Cherry 3', 'Cherry 4', 'Cherry 5', 'Cherry Rainier 1', 'Cherry Rainier 2', 'Cherry Rainier 3', 'Cherry Sour 1', 'Cherry Wax Black 1', 'Cherry Wax Red 1', 'Cherry Wax Red 2', 'Cherry Wax Red 3',
    'Cherry Wax Yellow 1', 'Cherry Wax not ripen 1', 'Cherry Wax not ripen 2', 'Chestnut 1', 'Clementine 1', 'Cocos 1', 'Corn 1', 'Corn Husk 1', 'Cucumber 1', 'Cucumber 10', 'Cucumber 11',
    'Cucumber 3', 'Cucumber 4', 'Cucumber 5', 'Cucumber 7', 'Cucumber 9', 'Cucumber Ripe 1', 'Cucumber Ripe 2', 'Dates 1', 'Eggplant 1', 'Eggplant long 1', 'Fig 1', 'Ginger Root 1', 'Gooseberry 1',
    'Granadilla 1', 'Grape Blue 1', 'Grape Pink 1', 'Grape White 1', 'Grape White 2', 'Grape White 3', 'Grape White 4', 'Grapefruit Pink 1', 'Grapefruit White 1', 'Guava 1', 'Hazelnut 1',
    'Huckleberry 1', 'Kaki 1', 'Kiwi 1', 'Kohlrabi 1', 'Kumquats 1', 'Lemon 1', 'Lemon Meyer 1', 'Limes 1', 'Lychee 1', 'Mandarine 1', 'Mango 1', 'Mango Red 1', 'Mangostan 1', 'Maracuja 1', 
    'Melon Piel de Sapo 1', 'Mulberry 1', 'Nectarine 1', 'Nectarine Flat 1', 'Nut 1', 'Nut 2', 'Nut 3', 'Nut 4', 'Nut 5', 'Nut Forest 1', 'Nut Pecan 1', 'Onion Red 1', 'Onion Red Peeled 1',
    'Onion White 1', 'Orange 1', 'Papaya 1', 'Passion Fruit 1', 'Peach 1', 'Peach 2', 'Peach Flat 1', 'Pear 1', 'Pear 2', 'Pear 3', 'Pear Abate 1', 'Pear Forelle 1', 'Pear Kaiser 1',
    'Pear Monster 1', 'Pear Red 1', 'Pear Stone 1', 'Pear Williams 1', 'Pepino 1', 'Pepper Green 1', 'Pepper Orange 1', 'Pepper Red 1', 'Pepper Yellow 1', 'Physalis 1', 'Physalis with Husk 1',
    'Pineapple 1', 'Pineapple Mini 1', 'Pistachio 1', 'Pitahaya Red 1', 'Plum 1', 'Plum 2', 'Plum 3', 'Pomegranate 1', 'Pomelo Sweetie 1', 'Potato Red 1', 'Potato Red Washed 1', 'Potato Sweet 1',
    'Potato White 1', 'Quince 1', 'Quince 2', 'Quince 3', 'Quince 4', 'Rambutan 1', 'Raspberry 1', 'Redcurrant 1', 'Salak 1', 'Strawberry 1', 'Strawberry Wedge 1', 'Tamarillo 1', 'Tangelo 1',
    'Tomato 1', 'Tomato 10', 'Tomato 2', 'Tomato 3', 'Tomato 4', 'Tomato 5', 'Tomato 7', 'Tomato 8', 'Tomato 9', 'Tomato Cherry Maroon 1', 'Tomato Cherry Orange 1', 'Tomato Cherry Red 1',
    'Tomato Cherry Red 2', 'Tomato Cherry Yellow 1', 'Tomato Heart 1', 'Tomato Maroon 1', 'Tomato Maroon 2', 'Tomato Yellow 1', 'Tomato not Ripen 1', 'Walnut 1', 'Watermelon 1', 'Zucchini 1',
    'Zucchini dark 1']
    
    device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    
    '''
    # Load model
    model = create_net(num_classes)
    model.load_state_dict(torch.load(model_path, weights_only=True))
    model = model.to(device)
    model.eval()  # Set to evaluation mode
    '''
    
    # Process different input types - check for UploadFile by attribute rather than isinstance
    if hasattr(image_input, 'file') and hasattr(image_input, 'filename'):
        # Handle UploadFile (check by attributes since isinstance might fail with imports)
        pil_image = process_upload_file(image_input)
        image_tensor = preprocess_image_for_inference(pil_image, device)
    elif isinstance(image_input, (str, Path)):
        # Handle file path
        transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))
        ])
        
        image_input = add_white_background(image_input)

        #image = Image.open(image_input).convert('RGB')
        image = image_input.convert('RGB')

        image_tensor = transform(image).unsqueeze(0).to(device)
    elif isinstance(image_input, Image.Image):
        # Handle PIL Image

        image_tensor = preprocess_image_for_inference(image_input, device)
    elif hasattr(image_input, 'to') and hasattr(image_input, 'dim'):
        # Handle PyTorch tensor
        image_tensor = image_input.to(device)
        if image_tensor.dim() == 3:  # Add batch dimension if missing
            image_tensor = image_tensor.unsqueeze(0)
    else:
        raise ValueError(f"Unsupported image input type: {type(image_input)}. Expected UploadFile, file path, PIL Image, or PyTorch tensor.")
    
    with torch.no_grad():
        output = model(image_tensor)
        probs = torch.softmax(output, dim=1)

        probability, predicted = torch.max(probs, 1)
        predicted_class = predicted.item()
        probability = probability.item()

    predicted_name = classnames[predicted_class]
    
    matched_names = []
    for classname in classnames:
        if classname.lower().startswith("apple"):
            matched_names.append([classname.lower(), classnames.index(classname), 0])
            
        elif classname.lower().startswith("cherry"):
            matched_names.append([classname.lower(), classnames.index(classname), 1])
            
        elif classname.lower().startswith("tomato"):
            matched_names.append([classname.lower(), classnames.index(classname), 2])  
        
        elif classname.lower().startswith("cucumber"):
            matched_names.append([classname.lower(), classnames.index(classname), 3])   
    
             
    print(f"classnames: {len(matched_names)} \n")
    if verbose:
        arr = []
        for i in range(len(probs[0])):
            prob = probs[0][i]
            arr.append([classnames[i], prob.item()])
        print(f"this is softmaxed output: {arr}")
        print(f"Predicted class: {predicted_name} with probability: {probability:.4f}")

    
    return probability, predicted_name



def test_model(net, testloader, device, class_names=None, show_predictions=True):
    """
    Test the model and optionally show predictions for a random batch
    
    Args:
        net: The trained model
        testloader: DataLoader for test data
        device: Device to run inference on
        class_names: List of class names for better visualization
        show_predictions: Whether to show prediction visualization
    
    Returns:
        accuracy: Overall test accuracy
    """
    net.eval()
    correct = 0
    total = 0
    class_correct = {}
    class_total = {}
    
    # Initialize per-class counters
    if class_names:
        for name in class_names:
            class_correct[name] = 0
            class_total[name] = 0
    
    # Store one random batch for visualization
    random_batch_images = None
    random_batch_labels = None
    random_batch_predictions = None
    
    with torch.no_grad():
        for i, data in enumerate(testloader):
            images, labels = data
            images, labels = images.to(device), labels.to(device)
            
            outputs = net(images)
            _, predicted = torch.max(outputs, 1)
            
            total += labels.size(0)
            correct += (predicted == labels).sum().item()
            
            # Calculate per-class accuracy
            if class_names:
                for j in range(labels.size(0)):
                    label = labels[j].item()
                    class_name = class_names[label]
                    class_total[class_name] += 1
                    if predicted[j] == labels[j]:
                        class_correct[class_name] += 1
            
            # Store a random batch for visualization (10% chance per batch)
            if show_predictions and random_batch_images is None and random.random() < 0.1:
                random_batch_images = images.cpu()
                random_batch_labels = labels.cpu()
                random_batch_predictions = predicted.cpu()
    
    # Calculate overall accuracy
    accuracy = 100 * correct / total
    print(f'Overall Test Accuracy: {accuracy:.2f}% ({correct}/{total})')
    
    # Print per-class accuracy
    if class_names:
        print("\nPer-class Accuracy:")
        print("-" * 40)
        for class_name in sorted(class_names):
            if class_total[class_name] > 0:
                class_acc = 100 * class_correct[class_name] / class_total[class_name]
                print(f'{class_name:20}: {class_acc:6.2f}% ({class_correct[class_name]}/{class_total[class_name]})')
    
    # Show predictions for random batch
    if show_predictions and random_batch_images is not None:
        print("\nShowing predictions for a random batch...")
        imshow_batch(random_batch_images, random_batch_labels, 
                    random_batch_predictions, class_names, 
                    "Random Test Batch - Predictions")
    
    return accuracy


def show_sample_predictions(net, testloader, device, class_names=None, num_samples=8):
    """
    Show predictions for specific samples (first batch)
    
    Args:
        net: The trained model
        testloader: DataLoader for test data
        device: Device to run inference on
        class_names: List of class names
        num_samples: Number of samples to show
    """
    net.eval()
    
    with torch.no_grad():
        # Get first batch
        data_iter = iter(testloader)
        for i in range( random.randint( 0, ( len(data_iter) - 1 ) ) ):
            images, labels = next(data_iter)
        images, labels = images.to(device), labels.to(device)
        
        outputs = net(images)
        _, predicted = torch.max(outputs, 1)
        
        # Show predictions
        imshow_batch(images.cpu()[:num_samples], labels.cpu()[:num_samples], 
                    predicted.cpu()[:num_samples], class_names, 
                    "Sample Predictions from First Test Batch")


if __name__ == '__main__':
    # Fixed transform - use consistent ImageNet preprocessing
    transform = transforms.Compose([
        transforms.Resize((224, 224)),  # ResNet expects 224x224
        transforms.ToTensor(),
        transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))  # ImageNet normalization
    ])
    
    # Initialize model
    net = create_net(206)  # Assuming 206 fruit classes
    batch_size = 32
    
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.SGD(net.parameters(), lr=0.001, momentum=0.9)
    
    # Data paths
    train_dir = '/Users/bennetjollenbeck/.cache/kagglehub/datasets/moltean/fruits/versions/46/fruits-360_100x100/fruits-360/Training'
    test_dir = '/Users/bennetjollenbeck/.cache/kagglehub/datasets/moltean/fruits/versions/46/fruits-360_100x100/fruits-360/Test'
    
    # Load datasets
    train_dataset = datasets.ImageFolder(root=train_dir, transform=transform)
    test_dataset = datasets.ImageFolder(root=test_dir, transform=transform)
    
    trainloader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, num_workers=2)
    testloader = DataLoader(test_dataset, batch_size=batch_size, shuffle=True, num_workers=2)
    
    # Get class names for better visualization
    class_names = train_dataset.classes
    print(f"Found {len(class_names)} classes: {class_names}                 ...")  # Show first 10
    
    # Training
    device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    '''print(f"Using device: {device}")
    net = net.to(device)
    
    print("Starting training...")
    for epoch in range(2):
        running_loss = 0.0
        for i, data in enumerate(trainloader, 0):
            inputs, labels = data
            inputs, labels = inputs.to(device), labels.to(device)
            
            # zero the parameter gradients
            optimizer.zero_grad()
            
            # forward + backward + optimize
            outputs = net(inputs)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            
            # print statistics
            running_loss += loss.item()
            if i % 100 == 99:    
                print(f'[{epoch + 1}, {i + 1:5d}] loss: {running_loss / 100:.3f}')
                running_loss = 0.0
    
    print('Finished Training')
    
    # Save model
    PATH = './fruit_resnet50.pth'
    torch.save(net.state_dict(), PATH)
    print(f"Saved the model to: {PATH}")'''
    
    
    model = create_net(206) # we do not specify ``weights``, i.e. create untrained model
    model.load_state_dict(torch.load('fruit_mobilenet_small.pth', weights_only=True))
    model = model.to(device)
    
    # Test the model
    print("\n" + "="*50)
    print("TESTING PHASE")
    print("="*50)
    
    input_shape = torch.rand((16, 3, 3, 3), dtype=torch.float32)
    input_shape = input_shape.to(device)
    torch.onnx.export(model, ( input_shape, ), "mobilenetV3_small.onnx", input_names=["input"], dynamo=True)
    
    #accuracy = test_model(model, testloader, device, class_names, show_predictions=True)
    
    # Show additional sample predictions
    
    # print("\nShowing specific sample predictions...")
    # for i in range(10):
    #     show_sample_predictions(model, testloader, device, class_names, num_samples=10)
    
    #print(f"\nFinal Test Accuracy: {accuracy:.2f}%")