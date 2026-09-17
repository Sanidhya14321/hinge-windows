import os
from PIL import Image, ImageDraw

os.makedirs("src/assets", exist_ok=True)

# 1. Generate 512x512 High-Res App Icon
size = 512
img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Background rounded rectangle
bg_color = (20, 24, 33, 255)
corner_radius = 110
draw.rounded_rectangle([20, 20, size - 20, size - 20], radius=corner_radius, fill=bg_color)

# Soft gradient / glow circle behind laptop
for r in range(160, 40, -10):
    alpha = int(12 * (1 - r / 160.0))
    draw.ellipse([size // 2 - r, size // 2 - r, size // 2 + r, size // 2 + r], fill=(0, 120, 212, alpha))

# Laptop Screen (folded with perspective)
screen_pts = [
    (140, 150),  # Top-left (tapered inward)
    (372, 150),  # Top-right (tapered inward)
    (392, 330),  # Bottom-right
    (120, 330),  # Bottom-left
]
draw.polygon(screen_pts, fill=(15, 45, 80, 255), outline=(0, 120, 212, 255))

# Inner screen glow / fold lines
for i in range(1, 5):
    t = i / 5.0
    y = 150 + int((330 - 150) * t)
    x1 = int(140 + (120 - 140) * t)
    x2 = int(372 + (392 - 372) * t)
    draw.line([(x1 + 10, y), (x2 - 10, y)], fill=(96, 205, 255, int(180 * (1 - t * 0.7))), width=2)

# Laptop Base (keyboard deck)
base_pts = [
    (100, 336),
    (412, 336),
    (430, 370),
    (82, 370),
]
draw.polygon(base_pts, fill=(45, 50, 62, 255), outline=(80, 88, 105, 255))

# Notch / trackpad
draw.rounded_rectangle([226, 350, 286, 356], radius=3, fill=(90, 100, 120, 255))

img.save("src/assets/icon.png", "PNG")

# Save as multi-resolution ICO
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
img.save("src/assets/icon.ico", format="ICO", sizes=sizes)
print("Saved icon.png and icon.ico")

# 2. Tray Inactive Icon (32x32)
tray_in = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
d_in = ImageDraw.Draw(tray_in)
# Screen
d_in.rounded_rectangle([7, 6, 24, 20], radius=2, outline=(230, 230, 230, 255), width=2)
# Base
d_in.line([(4, 23), (27, 23)], fill=(230, 230, 230, 255), width=2)
tray_in.save("src/assets/tray-inactive.png", "PNG")

# 3. Tray Active Icon (32x32 with green active dot)
tray_act = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
d_act = ImageDraw.Draw(tray_act)
# Screen with subtle fold taper
d_act.polygon([(9, 7), (22, 7), (24, 20), (7, 20)], outline=(255, 255, 255, 255))
# Base
d_act.line([(4, 23), (27, 23)], fill=(255, 255, 255, 255), width=2)
# Active indicator dot
d_act.ellipse([21, 4, 28, 11], fill=(16, 185, 129, 255))
tray_act.save("src/assets/tray-active.png", "PNG")

print("Saved tray-inactive.png and tray-active.png")
