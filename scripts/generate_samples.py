"""
画像diffアプリ用のテストサンプル（30枚、15ペア）を自動生成するスクリプト。
Pillow と Matplotlib を用いて、機械設計図面、解析グラフ、書類ワークフローの高品質な画像を生成し、
アライメント検証用の位置ズレ（回転、移動、拡大縮小）および軽微な差分（diff）を表現します。
"""

import os
import io
import numpy as np
import matplotlib
matplotlib.use('Agg')  # GUIを表示しない非インタラクティブモード
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from PIL import Image

# 出力先ディレクトリの設定
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLES_DIR = os.path.join(BASE_DIR, "samples")
os.makedirs(SAMPLES_DIR, exist_ok=True)

def apply_alignment_offset(img, rotate_deg=0, translate_px=(0, 0), scale_factor=1.0):
    """
    画像に対して位置ズレ（回転、平行移動、拡大縮小）を適用し、背景を白で塗りつぶす。
    """
    w, h = img.size

    # 1. 拡大縮小 (Sizing)
    if scale_factor != 1.0:
        new_w, new_h = int(w * scale_factor), int(h * scale_factor)
        img_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        background = Image.new("RGBA", (w, h), (255, 255, 255, 255))
        offset = ((w - new_w) // 2, (h - new_h) // 2)
        background.paste(img_resized, offset)
        img = background

    # 2. 回転 (Rotation)
    if rotate_deg != 0:
        # 背景色を白で埋める
        img = img.rotate(rotate_deg, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=(255, 255, 255, 255))

    # 3. 平行移動 (Translation)
    if translate_px != (0, 0):
        background = Image.new("RGBA", (w, h), (255, 255, 255, 255))
        background.paste(img, translate_px)
        img = background

    return img.convert("RGB")

def fig_to_img(fig):
    """
    MatplotlibのFigureオブジェクトをPillow Imageに変換する。
    """
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=100, bbox_inches='tight', pad_inches=0.1)
    buf.seek(0)
    img = Image.open(buf)
    # 800x600にリサイズして統一
    img = img.resize((800, 600), Image.Resampling.LANCZOS)
    return img.convert("RGBA")

# ==========================================
# 1. 機械設計図面 (Mechanical Drawings)
# ==========================================

def draw_gear(is_modified=False):
    """1. 歯車の図面"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')
    ax.set_xlim(-3, 3)
    ax.set_ylim(-3, 3)
    ax.axis('off')

    # 中心円とピッチ円
    center_circle = patches.Circle((0, 0), 0.4, fill=False, edgecolor='black', linewidth=1.5)
    pitch_circle = patches.Circle((0, 0), 1.8, fill=False, edgecolor='gray', linestyle='--', linewidth=1)
    ax.add_patch(center_circle)
    ax.add_patch(pitch_circle)

    # 歯の描画（通常24個の歯）
    num_teeth = 24
    for i in range(num_teeth):
        # B画像（変更あり）の場合、右上（インデックス4）の歯を欠損させる
        if is_modified and i == 4:
            continue

        angle = i * (2 * np.pi / num_teeth)
        # 歯の形状（簡易的な台形）
        r_inner = 1.6
        r_outer = 2.0
        w_inner = 0.15
        w_outer = 0.08

        # 4つの角の座標
        pts = [
            [r_inner * np.cos(angle - w_inner), r_inner * np.sin(angle - w_inner)],
            [r_outer * np.cos(angle - w_outer), r_outer * np.sin(angle - w_outer)],
            [r_outer * np.cos(angle + w_outer), r_outer * np.sin(angle + w_outer)],
            [r_inner * np.cos(angle + w_inner), r_inner * np.sin(angle + w_inner)]
        ]
        polygon = patches.Polygon(pts, fill=False, edgecolor='black', linewidth=1.5)
        ax.add_patch(polygon)

    # 中心十字線
    ax.plot([-2.5, 2.5], [0, 0], color='gray', linestyle='-.', linewidth=0.8)
    ax.plot([0, 0], [-2.5, 2.5], color='gray', linestyle='-.', linewidth=0.8)

    # 寸法線と文字
    ax.annotate('', xy=(-1.8, -2.2), xytext=(1.8, -2.2),
                arrowprops=dict(arrowstyle='<->', color='black', linewidth=1))
    dim_text = "D = 125.0" if is_modified else "D = 120.0"
    ax.text(0, -2.5, dim_text, ha='center', fontsize=12, fontweight='bold')
    ax.text(0, 2.5, "GEAR DETAIL", ha='center', fontsize=14, fontweight='bold')

    img = fig_to_img(fig)
    plt.close(fig)
    return img

def draw_flange(is_modified=False):
    """2. フランジ継手"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')
    ax.set_xlim(-4, 4)
    ax.set_ylim(-3, 3)
    ax.axis('off')

    # 外枠円
    ax.add_patch(patches.Circle((-1.5, 0), 1.8, fill=False, edgecolor='black', linewidth=2))
    # 内径円
    ax.add_patch(patches.Circle((-1.5, 0), 0.8, fill=False, edgecolor='black', linewidth=1.5))
    # ボルトピッチ円 (PCD)
    ax.add_patch(patches.Circle((-1.5, 0), 1.3, fill=False, edgecolor='gray', linestyle='--', linewidth=1))

    # ボルト穴の配置
    num_holes = 6 if is_modified else 4
    for i in range(num_holes):
        angle = i * (2 * np.pi / num_holes)
        x = -1.5 + 1.3 * np.cos(angle)
        y = 1.3 * np.sin(angle)
        ax.add_patch(patches.Circle((x, y), 0.15, fill=True, facecolor='lightgray', edgecolor='black', linewidth=1))

    # 右側に側面図を描画
    ax.plot([1.5, 1.5], [-1.8, 1.8], color='black', linewidth=2)
    ax.plot([2.2, 2.2], [-1.8, 1.8], color='black', linewidth=2)
    ax.plot([1.5, 2.2], [1.8, 1.8], color='black', linewidth=2)
    ax.plot([1.5, 2.2], [-1.8, -1.8], color='black', linewidth=2)
    # 中心貫通穴（側面図）
    ax.plot([1.5, 2.2], [0.8, 0.8], color='black', linestyle='--', linewidth=1.2)
    ax.plot([1.5, 2.2], [-0.8, -0.8], color='black', linestyle='--', linewidth=1.2)

    ax.text(0, 2.5, "FLANGE OUTLINE", ha='center', fontsize=14, fontweight='bold')
    ax.text(-1.5, -2.4, f"Holes: {num_holes}", ha='center', fontsize=11)

    img = fig_to_img(fig)
    plt.close(fig)
    return img

def draw_shaft(is_modified=False):
    """3. 段付きシャフト"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')
    ax.set_xlim(-1, 9)
    ax.set_ylim(-3, 3)
    ax.axis('off')

    # シャフトの段付き形状 (左から右へ)
    # 段1: (0, -1.5) to (3, 1.5)
    # 段2: (3, -1.0) to (6 or 7, 1.0) -> B画像で延長
    # 段3: (段2右端, -0.6) to (8, 0.6)
    d2_end = 7.0 if is_modified else 5.5

    # 段1 (太)
    ax.add_patch(patches.Rectangle((0, -1.5), 3.0, 3.0, fill=False, edgecolor='black', linewidth=2))
    # 段2 (中)
    ax.add_patch(patches.Rectangle((3.0, -1.0), d2_end - 3.0, 2.0, fill=False, edgecolor='black', linewidth=2))
    # 段3 (細)
    ax.add_patch(patches.Rectangle((d2_end, -0.6), 8.0 - d2_end, 1.2, fill=False, edgecolor='black', linewidth=2))

    # キー溝（段2の上に配置）
    kw_width = 0.6 if is_modified else 0.8
    ax.add_patch(patches.Rectangle((3.5, 1.0 - kw_width), 1.2, kw_width, fill=True, facecolor='white', edgecolor='black', linewidth=1.5))

    # ハッチング断面図 (段1の一部にハッチング)
    for x_h in np.arange(0.2, 2.8, 0.4):
        ax.plot([x_h, x_h + 0.4], [-1.5, -1.1], color='gray', linewidth=0.8)
        ax.plot([x_h, x_h + 0.4], [1.1, 1.5], color='gray', linewidth=0.8)

    ax.text(4, 2.4, "STEPPED SHAFT", ha='center', fontsize=14, fontweight='bold')
    ax.text(4, -2.4, "All dimensions in mm", ha='center', fontsize=10, style='italic')

    img = fig_to_img(fig)
    plt.close(fig)
    return img

def draw_bracket(is_modified=False):
    """4. L字ブラケット"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')
    ax.set_xlim(-1, 8)
    ax.set_ylim(-1, 6)
    ax.axis('off')

    # L字ベース形状
    ax.plot([0.5, 0.5, 5.0, 5.0, 1.5, 1.5, 0.5], [0.5, 4.5, 4.5, 3.5, 3.5, 0.5, 0.5], color='black', linewidth=2)

    # 補強用リブ（斜めプレート）をB画像で追加
    if is_modified:
        # (1.5, 0.5) から (5.0, 3.5) の対角にリブを描画
        ax.plot([1.5, 4.0], [1.5, 3.5], color='blue', linestyle='-', linewidth=2.5)
        ax.text(3.0, 2.0, "REINFORCED RIB", color='blue', fontsize=10, fontweight='bold')

    # 取付ボルト穴
    ax.add_patch(patches.Circle((1.0, 2.5), 0.2, fill=False, edgecolor='black', linewidth=1.5))
    ax.add_patch(patches.Circle((3.2, 4.0), 0.2, fill=False, edgecolor='black', linewidth=1.5))

    ax.text(3.5, 5.2, "L-BRACKET DESIGN", ha='center', fontsize=14, fontweight='bold')

    img = fig_to_img(fig)
    plt.close(fig)
    return img

def draw_bolt(is_modified=False):
    """5. ボルト・ナット"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')
    ax.set_xlim(-1, 9)
    ax.set_ylim(-3, 3)
    ax.axis('off')

    # 頭部 (六角形、左端)
    hexagon = patches.Polygon([[0, -1.2], [0.8, -1.5], [1.8, -1.2], [1.8, 1.2], [0.8, 1.5], [0, 1.2]], fill=False, edgecolor='black', linewidth=2)
    ax.add_patch(hexagon)

    # ボルトシャフト長
    shaft_len = 6.5 if is_modified else 5.5
    ax.add_patch(patches.Rectangle((1.8, -0.6), shaft_len, 1.2, fill=False, edgecolor='black', linewidth=2))

    # ねじ山 (ギザギザ)
    pitch = 0.25 if is_modified else 0.4
    x_start = 3.0
    x_end = 1.8 + shaft_len
    x_coords = np.arange(x_start, x_end, pitch)
    for x in x_coords:
        ax.plot([x, x + pitch/2], [0.6, 0.7], color='black', linewidth=1)
        ax.plot([x + pitch/2, x + pitch], [0.7, 0.6], color='black', linewidth=1)
        ax.plot([x, x + pitch/2], [-0.6, -0.7], color='black', linewidth=1)
        ax.plot([x + pitch/2, x + pitch], [-0.7, -0.6], color='black', linewidth=1)

    ax.text(4, 2.2, "M10 HEX BOLT DETAIL", ha='center', fontsize=14, fontweight='bold')
    ax.text(4, -2.2, f"Pitch: {pitch}mm, Length: {int(shaft_len*10)}mm", ha='center', fontsize=11)

    img = fig_to_img(fig)
    plt.close(fig)
    return img

def draw_pcb(is_modified=False):
    """6. 配線基板 (PCB)"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')
    ax.set_xlim(-1, 9)
    ax.set_ylim(-1, 7)
    ax.axis('off')

    # 基板外枠
    ax.add_patch(patches.Rectangle((0, 0), 8.0, 6.0, fill=False, edgecolor='green', linewidth=3))

    # 端子・パッド
    pads = [(1, 1), (1, 5), (7, 1), (7, 5), (4, 3)]
    # B画像（変更あり）では、中央のパッド (4, 3) を削除
    if is_modified:
        pads.remove((4, 3))

    for px, py in pads:
        ax.add_patch(patches.Circle((px, py), 0.3, fill=True, facecolor='gold', edgecolor='black', linewidth=1))
        ax.add_patch(patches.Circle((px, py), 0.1, fill=True, facecolor='white'))

    # 配線ルート 1
    ax.plot([1.3, 3.0, 4.5, 6.7], [1.0, 1.0, 2.5, 1.0], color='orange', linewidth=2.5)

    # 配線ルート 2 (B画像でルート変更)
    if is_modified:
        # 別ルートに変更
        ax.plot([1.3, 3.0, 5.0, 6.7], [5.0, 4.0, 4.0, 5.0], color='orange', linewidth=2.5)
    else:
        # 元ルート
        ax.plot([1.3, 4.0, 6.7], [5.0, 5.0, 5.0], color='orange', linewidth=2.5)

    ax.text(4, 6.3, "PCB TRACE LAYOUT", ha='center', fontsize=14, fontweight='bold', color='darkgreen')

    img = fig_to_img(fig)
    plt.close(fig)
    return img

# ==========================================
# 2. 解析データ (Graphs & Analysis)
# ==========================================

def draw_stress_strain(is_modified=False):
    """7. 応力-ひずみ曲線"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')

    # データ生成
    x = np.linspace(0, 10, 200)
    # AとBで強度（曲線のピーク）を変更
    peak_factor = 1.3 if is_modified else 1.0
    y = 500 * (1 - np.exp(-0.6 * x)) * np.exp(-0.05 * x) * peak_factor

    ax.plot(x, y, label='Alloy Steel (Spec-B)' if is_modified else 'Alloy Steel (Spec-A)', color='blue', linewidth=2.5)
    ax.set_title("STRESS-STRAIN CURVE", fontsize=14, fontweight='bold')
    ax.set_xlabel("Strain (%)", fontsize=11)
    ax.set_ylabel("Stress (MPa)", fontsize=11)
    ax.grid(True, linestyle=':', alpha=0.6)
    ax.legend(loc='upper right')

    # 降伏点アノテーションのズレ
    ann_x = 1.8 if is_modified else 1.5
    ann_y = y[int(ann_x * 20)]
    ax.annotate('Yield Point', xy=(ann_x, ann_y), xytext=(ann_x + 1.5, ann_y - 80),
                arrowprops=dict(facecolor='black', shrink=0.05, width=1, headwidth=6))

    img = fig_to_img(fig)
    plt.close(fig)
    return img

def draw_thermal_heatmap(is_modified=False):
    """8. 熱解析カラーマップ"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)

    # 2次元グリッド
    x = np.linspace(-3, 3, 200)
    y = np.linspace(-3, 3, 200)
    X, Y = np.meshgrid(x, y)

    # ガウシアン分布（Aは中央、Bは右上偏心）
    cx, cy = (0.5, 0.5) if is_modified else (0.0, 0.0)
    Z = np.exp(-((X - cx)**2 + (Y - cy)**2) / 2.0)

    # カラーマップの描画
    im = ax.imshow(Z, cmap='jet', extent=[-3, 3, -3, 3], origin='lower')
    fig.colorbar(im, ax=ax, label="Temperature (°C)")

    ax.set_title("THERMAL DISTRIBUTION HEATMAP", fontsize=14, fontweight='bold')
    ax.set_xlabel("X (mm)")
    ax.set_ylabel("Y (mm)")

    img = fig_to_img(fig)
    plt.close(fig)
    return img

def draw_fft_spectrum(is_modified=False):
    """9. 振動スペクトル"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')

    freq = np.linspace(0, 500, 500)
    # ベースノイズ
    np.random.seed(42)
    noise = np.random.normal(0, 0.05, 500)

    # ピーク
    p1 = 2.0 * np.exp(-((freq - 60)/5)**2)
    p2 = 1.5 * np.exp(-((freq - 180)/8)**2)

    if is_modified:
        # ピーク3消失、新しい高周波ピーク出現
        p3 = 0.1 * np.exp(-((freq - 320)/10)**2) # ほぼフラット
        p4 = 0.8 * np.exp(-((freq - 420)/6)**2) # 新規出現
        amp = p1 + p2 + p3 + p4 + noise + 0.1
    else:
        p3 = 1.2 * np.exp(-((freq - 320)/10)**2)
        amp = p1 + p2 + p3 + noise + 0.1

    ax.plot(freq, amp, color='purple', linewidth=1.5)
    ax.set_title("VIBRATION FFT SPECTRUM", fontsize=14, fontweight='bold')
    ax.set_xlabel("Frequency (Hz)", fontsize=11)
    ax.set_ylabel("Amplitude (G)", fontsize=11)
    ax.grid(True, which='both', linestyle='--', alpha=0.5)
    ax.set_ylim(0, 2.5)

    img = fig_to_img(fig)
    plt.close(fig)
    return img

def draw_bathtub_curve(is_modified=False):
    """10. バスタブ曲線"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')

    t = np.linspace(0.1, 10, 200)

    # U字曲線の構成（初期故障、偶発故障、摩耗故障）
    early = 1.5 / t
    random_fail = np.ones_like(t) * 0.15

    # B画像で摩耗故障の開始点を左（早め）にシフト
    wear_start = 6.0 if is_modified else 7.5
    wear = np.exp(t - wear_start) * 0.05

    total = early + random_fail + wear

    ax.plot(t, total, color='crimson', linewidth=2.5, label='Combined Failure Rate')
    ax.plot(t, early, 'g--', alpha=0.6, label='Infant Mortality')
    ax.plot(t, random_fail, 'b--', alpha=0.6, label='Useful Life')
    ax.plot(t, wear, 'y--', alpha=0.6, label='Wear-out Phase')

    ax.set_title("RELIABILITY BATHTUB CURVE", fontsize=14, fontweight='bold')
    ax.set_xlabel("Time (Years)", fontsize=11)
    ax.set_ylabel("Failure Rate", fontsize=11)
    ax.set_ylim(0, 2.0)
    ax.legend()
    ax.grid(True, linestyle=':', alpha=0.6)

    img = fig_to_img(fig)
    plt.close(fig)
    return img

# ==========================================
# 3. 書類・ワークフロー (Documents & Workflows)
# ==========================================

def draw_bom(is_modified=False):
    """11. 部品表 (BOM)"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')
    ax.axis('off')

    # テーブル用データ
    col_labels = ['Item No', 'Part Name', 'Qty', 'Material', 'Weight (g)']

    row_data = [
        ['1', 'Main Shaft', '1', 'S45C', '1,250'],
        ['2', 'Flange Coupling', '2', 'FC250', '850'],
        ['3', 'Hex Bolt M10', '5' if is_modified else '2', 'S45C' if is_modified else 'SUS304', '45'],
        ['4', 'Ball Bearing #6204', '2', 'SUJ2', '110'],
        ['5', 'Lock Nut M20', '1', 'SS400', '30']
    ]

    table = ax.table(cellText=row_data, colLabels=col_labels, loc='center', cellLoc='center')
    table.auto_set_font_size(False)
    table.set_fontsize(11)
    table.scale(1.0, 2.0)  # 高さを広げる

    # ヘッダー行の色
    for k, cell in table.get_celld().items():
        if k[0] == 0:
            cell.set_facecolor('lightsteelblue')
            cell.set_text_props(weight='bold')
        elif is_modified and k[0] == 3 and k[1] in [2, 3]:  # 変更セルを着色
            cell.set_facecolor('mistyrose')

    ax.text(0.5, 0.85, "BILL OF MATERIALS (BOM)", ha='center', fontsize=14, fontweight='bold')
    ax.text(0.5, 0.15, "Project: Rotary Drive Assembly V1.2", ha='center', fontsize=11, style='italic')

    img = fig_to_img(fig)
    plt.close(fig)
    return img

def draw_ecn(is_modified=False):
    """12. 設計変更通知書 (ECN)"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.axis('off')

    # 書類外枠
    ax.add_patch(patches.Rectangle((0.5, 0.5), 9.0, 9.0, fill=False, edgecolor='black', linewidth=1.5))

    # タイトルと日付
    ax.text(5.0, 8.8, "ENGINEERING CHANGE NOTICE (ECN)", ha='center', fontsize=14, fontweight='bold')
    ax.text(1.0, 8.0, "Document ID: ECN-2026-005", fontsize=11)
    ax.text(7.0, 8.0, "Date: 2026-05-06", fontsize=11)

    # 罫線
    ax.plot([0.5, 9.5], [7.7, 7.7], color='black', linewidth=1)
    ax.plot([0.5, 9.5], [2.5, 2.5], color='black', linewidth=1)

    # 変更概要
    ax.text(1.0, 7.2, "Description of Change:", fontweight='bold', fontsize=12)
    desc_txt = (
        "1. Shaft diameter increased from 20mm to 22mm to handle increased load.\n"
        "2. Keyway width modified from 8mm to 6mm to fit new coupling specification.\n"
        "3. Hex bolt quantity increased from 2 to 5 for added structural stability."
    ) if is_modified else (
        "1. Shaft diameter increased from 20mm to 22mm to handle increased load.\n"
        "2. Keyway width modified from 8mm to 6mm to fit new coupling specification."
    )
    ax.text(1.0, 5.5, desc_txt, fontsize=10, va='top')

    # 承認印スペース
    ax.add_patch(patches.Rectangle((7.0, 1.0), 2.0, 1.2, fill=False, edgecolor='gray', linestyle='--'))
    ax.text(8.0, 2.3, "Approval", ha='center', fontsize=10, fontweight='bold')

    # A画像の場合のみ「承認印」を描画
    if not is_modified:
        # 赤インクの丸い印影
        seal = patches.Circle((8.0, 1.6), 0.45, fill=False, edgecolor='red', linewidth=2)
        ax.add_patch(seal)
        ax.text(8.0, 1.55, "APPROVED", color='red', fontsize=7, fontweight='bold', ha='center', va='center')

    img = fig_to_img(fig)
    plt.close(fig)
    return img

def draw_workflow_flowchart(is_modified=False):
    """13. 承認フローチャート"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 6)
    ax.axis('off')

    # ボックス配置
    box_w, box_h = 1.6, 0.8
    # 1. 設計
    ax.add_patch(patches.Rectangle((0.5, 2.6), box_w, box_h, fill=True, facecolor='aliceblue', edgecolor='black', linewidth=1.5))
    ax.text(1.3, 3.0, "Design", ha='center', va='center', fontsize=11, fontweight='bold')

    # 2. 検図
    ax.add_patch(patches.Rectangle((3.0, 2.6), box_w, box_h, fill=True, facecolor='aliceblue', edgecolor='black', linewidth=1.5))
    ax.text(3.8, 3.0, "Verification", ha='center', va='center', fontsize=11, fontweight='bold')

    # 3. 承認
    ax.add_patch(patches.Rectangle((5.5, 2.6), box_w, box_h, fill=True, facecolor='aliceblue', edgecolor='black', linewidth=1.5))
    ax.text(6.3, 3.0, "Approval", ha='center', va='center', fontsize=11, fontweight='bold')

    # 4. 出図
    ax.add_patch(patches.Rectangle((8.0, 2.6), box_w, box_h, fill=True, facecolor='honeydew', edgecolor='black', linewidth=1.5))
    ax.text(8.8, 3.0, "Release", ha='center', va='center', fontsize=11, fontweight='bold')

    # 矢印
    ax.annotate('', xy=(3.0, 3.0), xytext=(2.1, 3.0), arrowprops=dict(arrowstyle="->", color="black", linewidth=1.5))
    ax.annotate('', xy=(5.5, 3.0), xytext=(4.6, 3.0), arrowprops=dict(arrowstyle="->", color="black", linewidth=1.5))
    ax.annotate('', xy=(8.0, 3.0), xytext=(7.1, 3.0), arrowprops=dict(arrowstyle="->", color="black", linewidth=1.5))

    # B画像のみ: 「検図(Verification)」から戻る「修正(Rework)」フローを追加
    if is_modified:
        # 修正ボックス (下部に配置)
        ax.add_patch(patches.Rectangle((3.0, 0.8), box_w, box_h, fill=True, facecolor='mistyrose', edgecolor='black', linewidth=1.5))
        ax.text(3.8, 1.2, "Rework", ha='center', va='center', fontsize=11, fontweight='bold', color='crimson')

        # 検図 -> 修正 への下矢印
        ax.annotate('', xy=(3.8, 1.6), xytext=(3.8, 2.6), arrowprops=dict(arrowstyle="->", color="crimson", linewidth=1.5))
        # 修正 -> 設計 への左上矢印
        ax.annotate('', xy=(1.3, 2.6), xytext=(3.0, 1.2), arrowprops=dict(arrowstyle="->", color="crimson", linewidth=1.5, connectionstyle="arc3,rad=-0.1"))

    ax.text(5.0, 5.0, "DOCUMENT APPROVAL WORKFLOW", ha='center', fontsize=14, fontweight='bold')

    img = fig_to_img(fig)
    plt.close(fig)
    return img

def draw_factory_layout(is_modified=False):
    """14. 工場レイアウト"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 8)
    ax.axis('off')

    # 工場外壁
    ax.add_patch(patches.Rectangle((0.5, 0.5), 9.0, 7.0, fill=False, edgecolor='black', linewidth=2))

    # 各設備
    # 1. CNC旋盤 (左側)
    cnc_y = 1.5 if is_modified else 3.5
    ax.add_patch(patches.Rectangle((1.5, cnc_y), 2.0, 1.5, fill=True, facecolor='lightblue', edgecolor='black', linewidth=1.5))
    ax.text(2.5, cnc_y + 0.75, "CNC Lathe", ha='center', va='center', fontsize=11, fontweight='bold')

    # 2. マシニングセンタ (中央上)
    ax.add_patch(patches.Rectangle((5.0, 4.5), 2.5, 1.8, fill=True, facecolor='lightgreen', edgecolor='black', linewidth=1.5))
    ax.text(6.25, 5.4, "Machining\nCenter", ha='center', va='center', fontsize=11, fontweight='bold')

    # 3. 作業台 (右下)
    ax.add_patch(patches.Rectangle((5.0, 1.5), 1.8, 1.2, fill=True, facecolor='orange', edgecolor='black', linewidth=1.5))
    ax.text(5.9, 2.1, "Work Bench", ha='center', va='center', fontsize=11, fontweight='bold')

    # B画像のみ: 新たに「測定ベンチ」を追加
    if is_modified:
        ax.add_patch(patches.Rectangle((1.5, 4.5), 2.0, 1.2, fill=True, facecolor='lightyellow', edgecolor='black', linewidth=1.5))
        ax.text(2.5, 5.1, "Metrology Bench", ha='center', va='center', fontsize=10, fontweight='bold')

    ax.text(5.0, 7.1, "FACTORY FLOOR PLAN", ha='center', fontsize=14, fontweight='bold')

    img = fig_to_img(fig)
    plt.close(fig)
    return img

def draw_inspection_certificate(is_modified=False):
    """15. 検査成績書"""
    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.set_facecolor('white')
    ax.axis('off')

    col_labels = ['Parameter', 'Spec Range', 'Measured Value', 'Status']

    row_data = [
        ['Overall Length', '120.0 ±0.5 mm', '120.15 mm', 'OK'],
        ['Shaft Diameter', '22.0 +0.1/-0.0 mm', '22.04 mm', 'OK'],
        ['Tensile Strength', '> 450 MPa', '425 MPa' if is_modified else '485 MPa', 'NG' if is_modified else 'OK'],
        ['Hardness', 'HRC 30 ±2', '31 HRC', 'OK'],
        ['Visual Inspection', 'No Defects', 'Clear', 'OK']
    ]

    table = ax.table(cellText=row_data, colLabels=col_labels, loc='center', cellLoc='center')
    table.auto_set_font_size(False)
    table.set_fontsize(11)
    table.scale(1.0, 2.0)

    # 装飾
    for k, cell in table.get_celld().items():
        if k[0] == 0:
            cell.set_facecolor('darkslategray')
            cell.set_text_props(weight='bold', color='white')
        else:
            # 判定セルの着色
            if k[1] == 3:
                val = row_data[k[0]-1][3]
                if val == 'NG':
                    cell.set_text_props(weight='bold', color='red')
                    cell.set_facecolor('lightpink')
                else:
                    cell.set_text_props(weight='bold', color='green')
                    cell.set_facecolor('lightgreen')
            elif is_modified and k[0] == 3 and k[1] == 2:  # 変更された測定値
                cell.set_facecolor('mistyrose')

    ax.text(0.5, 0.85, "INSPECTION CERTIFICATE", ha='center', fontsize=14, fontweight='bold')
    ax.text(0.5, 0.15, "Inspector: John Doe", ha='center', fontsize=11, style='italic')

    img = fig_to_img(fig)
    plt.close(fig)
    return img

# ==========================================
# メイン画像生成ロジック
# ==========================================

def generate_all_samples():
    """15個のペア、全30枚のサンプル画像を生成・加工して保存する"""
    generators = {
        "gear": (draw_gear, 3.0, (0, 0), 1.0),                  # 回転 3.0度
        "flange": (draw_flange, 0.0, (8, -5), 1.0),             # 平行移動 (8, -5)px
        "shaft": (draw_shaft, 0.0, (0, 0), 0.97),               # 縮小 3%
        "bracket": (draw_bracket, 0.0, (0, 0), 1.0),            # 差分のみ
        "bolt": (draw_bolt, -1.5, (0, 0), 1.0),                 # 回転 -1.5度
        "pcb": (draw_pcb, 4.0, (0, 0), 1.0),                    # 回転 4.0度
        "stress_strain": (draw_stress_strain, 0.0, (15, 0), 1.0), # 平行移動 (15, 0)px
        "thermal_heatmap": (draw_thermal_heatmap, 0.0, (-5, -5), 1.0), # 平行移動 (-5, -5)px
        "fft_spectrum": (draw_fft_spectrum, 0.0, (0, 0), 1.05), # 拡大 5%
        "bathtub_curve": (draw_bathtub_curve, 0.0, (0, 0), 1.0), # 差分のみ
        "bom": (draw_bom, 0.0, (0, 0), 1.0),                    # 差分のみ
        "ecn": (draw_ecn, -5.0, (0, 0), 1.0),                   # 回転 -5.0度
        "workflow_flowchart": (draw_workflow_flowchart, 0.0, (0, 0), 1.0), # 差分のみ
        "factory_layout": (draw_factory_layout, 0.0, (0, 0), 1.0), # 差分のみ
        "inspection_certificate": (draw_inspection_certificate, 0.0, (0, 0), 1.0) # 差分のみ
    }

    for name, (draw_func, rot, trans, scale) in generators.items():
        print(f"Generating: {name}ペア...")

        # 1. 基準画像Aの生成
        img_a = draw_func(is_modified=False)
        # 基準画像はズレなし
        final_a = apply_alignment_offset(img_a, rotate_deg=0, translate_px=(0, 0), scale_factor=1.0)
        final_a.save(os.path.join(SAMPLES_DIR, f"{name}_a.png"), "PNG")

        # 2. 変更版画像Bの生成
        img_b = draw_func(is_modified=True)
        # ズレパラメータの適用
        final_b = apply_alignment_offset(img_b, rotate_deg=rot, translate_px=trans, scale_factor=scale)
        final_b.save(os.path.join(SAMPLES_DIR, f"{name}_b.png"), "PNG")

    print(f"\nすべてのサンプル画像 ({len(generators) * 2}枚) が '{SAMPLES_DIR}' に正常に生成されました！")

if __name__ == "__main__":
    generate_all_samples()
