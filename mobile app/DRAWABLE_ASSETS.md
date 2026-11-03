# Android Drawable Assets Reference (`res/drawable-xxhdpi/`)

All controller buttons, analog sticks, system buttons, and mini status badges are loaded via `painterResource(R.drawable.<name>)` from:

```text
android_app/app/src/main/res/drawable-xxhdpi/
```

Valid transparent PNG placeholder files are pre-created in `res/drawable-xxhdpi/` so the Gradle build compiles with zero missing-resource errors out of the box. Replace any file below with your own PNG or WebP artwork (using the exact same resource base name) without modifying any Kotlin code.

## Complete Expected Filename List (24 Files)

### 1. PlayStation Face Buttons
| Filename | Resource ID | Default Size (dp) | Description |
| :--- | :--- | :--- | :--- |
| `btn_cross.png` | `R.drawable.btn_cross` | `58 x 58 dp` | Cross (Bottom face button) |
| `btn_circle.png` | `R.drawable.btn_circle` | `58 x 58 dp` | Circle (Right face button) |
| `btn_square.png` | `R.drawable.btn_square` | `58 x 58 dp` | Square (Left face button) |
| `btn_triangle.png` | `R.drawable.btn_triangle` | `58 x 58 dp` | Triangle (Top face button) |

### 2. Directional Pad (D-Pad)
| Filename | Resource ID | Default Size (dp) | Description |
| :--- | :--- | :--- | :--- |
| `dpad_up.png` | `R.drawable.dpad_up` | `54 x 54 dp` | D-Pad Up segment |
| `dpad_down.png` | `R.drawable.dpad_down` | `54 x 54 dp` | D-Pad Down segment |
| `dpad_left.png` | `R.drawable.dpad_left` | `54 x 54 dp` | D-Pad Left segment |
| `dpad_right.png` | `R.drawable.dpad_right` | `54 x 54 dp` | D-Pad Right segment |

### 3. Shoulder & Analog Trigger Buttons
| Filename | Resource ID | Default Size (dp) | Description |
| :--- | :--- | :--- | :--- |
| `btn_l1.png` | `R.drawable.btn_l1` | `92 x 46 dp` | L1 Left Bumper |
| `btn_r1.png` | `R.drawable.btn_r1` | `92 x 46 dp` | R1 Right Bumper |
| `btn_l2.png` | `R.drawable.btn_l2` | `92 x 50 dp` | L2 Left Trigger |
| `btn_r2.png` | `R.drawable.btn_r2` | `92 x 50 dp` | R2 Right Trigger |

### 4. Analog Sticks & L3/R3 Thumb Buttons
| Filename | Resource ID | Default Size (dp) | Description |
| :--- | :--- | :--- | :--- |
| `stick_base.png` | `R.drawable.stick_base` | `144 x 144 dp` | Outer analog stick ring / gate |
| `stick_cap.png` | `R.drawable.stick_cap` | `64 x 64 dp` | Movable analog thumbstick cap |
| `btn_l3.png` | `R.drawable.btn_l3` | `52 x 32 dp` | Dedicated L3 stick-click button |
| `btn_r3.png` | `R.drawable.btn_r3` | `52 x 32 dp` | Dedicated R3 stick-click button |

### 5. Center / System DualShock 4 Buttons
| Filename | Resource ID | Default Size (dp) | Description |
| :--- | :--- | :--- | :--- |
| `btn_share.png` | `R.drawable.btn_share` | `56 x 34 dp` | Share / Select button |
| `btn_options.png` | `R.drawable.btn_options` | `56 x 34 dp` | Options / Start button |
| `btn_ps.png` | `R.drawable.btn_ps` | `46 x 46 dp` | PlayStation Home button |
| `btn_touchpad.png` | `R.drawable.btn_touchpad` | `150 x 64 dp` | DualShock 4 center touchpad click button |

### 6. UI Icons, App Logo & Transport Mini-Badges
| Filename | Resource ID | Default Size (dp) | Description |
| :--- | :--- | :--- | :--- |
| `ic_settings.png` | `R.drawable.ic_settings` | `32 x 32 dp` | Top-right semi-transparent gear icon on Gameplay Screen |
| `logo_app.png` | `R.drawable.logo_app` | `40 x 40 dp` | App logo displayed in the Start Screen header |
| `ic_badge_usb.png` | `R.drawable.ic_badge_usb` | `20 x 20 dp` | Mini USB badge icon (`adb reverse` mode) |
| `ic_badge_wifi.png` | `R.drawable.ic_badge_wifi` | `20 x 20 dp` | Mini Wi-Fi badge icon (UDP mode) |

## Pressed State Behavior in Code
No Canvas drawing, text, or emoji is used to render any control. Every control is rendered with `Image(painter = painterResource(resId), contentDescription = null)`. When pressed:
- Scale animates/switches to `0.92f` (`scaleX = 0.92f`, `scaleY = 0.92f`)
- Alpha lowers to `element.opacity * 0.68f`
