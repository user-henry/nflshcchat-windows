from PIL import Image

src = r"C:\Users\黄兴\Desktop\近期任务\nflshcchat-windows\assets\icon.png"
dst = r"C:\Users\黄兴\Desktop\近期任务\nflshcchat-windows\assets\icon.ico"

sizes = [16, 32, 48, 64, 128, 256]
img = Image.open(src).convert("RGBA")

frames = []
for s in sizes:
    frames.append(img.resize((s, s), Image.LANCZOS))

frames[0].save(dst, sizes=[(s, s) for s in sizes], append_images=frames[1:])
print("ICO created:", dst)
