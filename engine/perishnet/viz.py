"""Static figures and an animated network GIF (matplotlib only)."""

import math

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import animation
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.patches import Circle, FancyArrowPatch, Rectangle

from .model import Params, make_streams
from .policies import LABELS, POLICIES
from .simulate import simulate

INK = "#121816"
MUTED = "#7f8884"
GRID = "#e2e6e3"
BG = "#f6f7f5"
TEAL = "#0d6b63"
AMBER = "#a86a00"
RED = "#bf3a2b"
COLORS = {"none": "#8b9490", "count": "#b07a00", "age": TEAL}
# Life-left colour scale: about to expire (amber) -> fresh (teal).
LIFE_CMAP = LinearSegmentedColormap.from_list("life", ["#e3a23b", "#9fb38a", TEAL])

plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": BG, "savefig.facecolor": BG,
    "axes.edgecolor": GRID, "axes.labelcolor": INK, "text.color": INK,
    "xtick.color": MUTED, "ytick.color": MUTED, "axes.grid": True,
    "grid.color": GRID, "grid.linewidth": 0.8, "axes.spines.top": False,
    "axes.spines.right": False, "font.size": 10, "axes.titleweight": "bold",
    "axes.titlesize": 11, "axes.titlelocation": "left",
})


def life_color(r, life):
    return LIFE_CMAP((r - 1) / max(1, life - 1))


def fig_cumulative_cost(results, path):
    fig, ax = plt.subplots(figsize=(8, 4))
    for name, res in results.items():
        ax.plot(res.cumulative, color=COLORS[name], lw=2, label=LABELS[name])
        ax.scatter([len(res.cumulative) - 1], [res.cumulative[-1]], color=COLORS[name], s=20, zorder=3)
    ax.set_xlabel("period t")
    ax.set_ylabel("cumulative cost")
    ax.set_title("Cumulative cost: same supply and demand, three policies")
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def fig_rates(results, path):
    names = list(results)
    fig, axes = plt.subplots(1, 3, figsize=(10, 3.4))
    metrics = [
        ("Wasted / supplied", [results[n].waste_rate * 100 for n in names], "%"),
        ("Unmet / demanded", [results[n].unmet_rate * 100 for n in names], "%"),
        ("Cost per unit of demand", [results[n].cost_per_demand for n in names], ""),
    ]
    for ax, (title, vals, unit) in zip(axes, metrics):
        bars = ax.bar(range(len(names)), vals, color=[COLORS[n] for n in names], width=0.6)
        ax.set_xticks(range(len(names)), [LABELS[n].split(" ")[0] for n in names])
        ax.set_title(title)
        ax.grid(axis="x", visible=False)
        for b, v in zip(bars, vals):
            ax.text(b.get_x() + b.get_width() / 2, b.get_height(), f"{v:.1f}{unit}" if unit else f"{v:.2f}",
                    ha="center", va="bottom", fontsize=9, color=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def fig_stock_age(results, P, path, policies=("none", "age")):
    """Stacked area: total stock by periods of life left, over time."""
    fig, axes = plt.subplots(1, len(policies), figsize=(11, 4.2), sharey=True)
    for ax, name in zip(axes, policies):
        ax.set_axisbelow(True)
        tr = results[name].trace
        layers = [[sum(p.stock_start[i][r] for i in range(P.n_nodes)) for p in tr] for r in range(1, P.life + 1)]
        ax.stackplot(range(len(tr)), layers, colors=[life_color(r, P.life) for r in range(1, P.life + 1)],
                     labels=[f"{r} left" for r in range(1, P.life + 1)], lw=0)
        wasted = [sum(p.wasted) for p in tr]
        ax.plot(range(len(tr)), wasted, color=RED, lw=0.8, alpha=0.8, label="wasted this period")
        ax.set_title(LABELS[name])
        ax.set_xlabel("period t")
    axes[0].set_ylabel("items in stock (all nodes)")
    handles, labels = axes[-1].get_legend_handles_labels()
    fig.legend(handles, labels, frameon=False, fontsize=8, loc="lower center", ncol=P.life + 1)
    fig.suptitle("Age profile of stock: amber = close to expiry, teal = fresh", x=0.01, ha="left", fontweight="bold")
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    fig.savefig(path, dpi=150)
    plt.close(fig)


def fig_delay_sweep(P, path, delays=range(0, 7), seeds=range(1, 9)):
    """Cost per unit of demand against information delay, mean and min-max band over seeds."""
    fig, ax = plt.subplots(figsize=(8, 4))
    for name in POLICIES:
        means, lo, hi = [], [], []
        for d in delays:
            vals = []
            for s in seeds:
                q = Params(P.n_nodes, P.life, P.rho, P.mismatch, d, P.h, P.p, P.c, s, P.horizon)
                vals.append(simulate(q, name, keep_trace=False).cost_per_demand)
            means.append(sum(vals) / len(vals))
            lo.append(min(vals))
            hi.append(max(vals))
        ax.fill_between(list(delays), lo, hi, color=COLORS[name], alpha=0.12, lw=0)
        ax.plot(list(delays), means, "-o", color=COLORS[name], lw=2, ms=4, label=LABELS[name])
    ax.set_xlabel("information delay δ (periods)")
    ax.set_ylabel("cost per unit of demand")
    ax.set_title(f"Value of fresh information (mean and range over {len(list(seeds))} seeds)")
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def _layout(n):
    """Node 1 (the supply-heavy node) on the left, the rest on an arc."""
    pts = []
    for i in range(n):
        ang = math.pi - 2 * math.pi * i / n
        pts.append((math.cos(ang), math.sin(ang) * 0.8))
    return pts


def animate_network(results, P, path, policies=("none", "age"), start=40, periods=24, substeps=6, fps=12):
    """Side-by-side GIF: two policies on the same random draws.

    Each period plays in sub-steps: items travel along the edges, red rings
    mark unmet demand, amber crosses mark waste. Bars inside each node show
    stock by periods of life left.
    """
    pos = _layout(P.n_nodes)
    rmax = max(P.lam)
    window = range(start, start + periods)
    peak = max(sum(results[n].trace[t].stock_start[i]) for n in policies for t in window for i in range(P.n_nodes)) or 1
    fig, axes = plt.subplots(1, len(policies), figsize=(10, 4.6))
    fig.subplots_adjust(left=0.02, right=0.98, top=0.86, bottom=0.04, wspace=0.05)

    def draw(frame):
        t = start + frame // substeps
        s = (frame % substeps + 1) / substeps
        for ax, name in zip(axes, policies):
            ax.cla()
            ax.set_xlim(-1.45, 1.45)
            ax.set_ylim(-1.25, 1.2)
            ax.set_aspect("equal")
            ax.axis("off")
            res = results[name]
            p = res.trace[t]
            ax.set_title(f"{LABELS[name]}    period {t}    cost so far {res.cumulative[t]:.0f}",
                         fontsize=10, color=INK, loc="left")
            for i in range(P.n_nodes):
                for j in range(i + 1, P.n_nodes):
                    ax.plot([pos[i][0], pos[j][0]], [pos[i][1], pos[j][1]], color=GRID, lw=1, zorder=0)
            stock = p.stock_start if s < 0.5 else p.stock_end
            for i, (x, y) in enumerate(pos):
                rad = 0.17 + 0.13 * math.sqrt(P.lam[i] / rmax)
                ax.add_patch(Circle((x, y), rad, facecolor="white", edgecolor=MUTED, lw=1, zorder=2))
                base = y - rad * 0.65
                h_tot = rad * 1.3
                bw = rad * 0.7
                acc = 0
                for r in range(1, P.life + 1):
                    k = stock[i][r]
                    if k:
                        hgt = h_tot * k / peak
                        ax.add_patch(Rectangle((x - bw / 2, base + acc), bw, hgt, facecolor=life_color(r, P.life),
                                               edgecolor="white", lw=0.4, zorder=3))
                        acc += hgt
                ax.text(x, y + rad + 0.06, f"node {i + 1}  λ={P.lam[i]:g}", ha="center", fontsize=8, color=MUTED)
                ax.text(x + bw / 2 + 0.03, base, f"{sum(stock[i])}", fontsize=8, color=INK, va="bottom", zorder=5)
                if p.unmet[i] and s > 0.5:
                    ax.add_patch(Circle((x, y), rad + 0.04, fill=False, edgecolor=RED, lw=2.5, alpha=min(1, (s - 0.5) * 2), zorder=4))
                    ax.text(x, y - rad - 0.13, f"{p.unmet[i]} unmet", ha="center", fontsize=8, color=RED)
                if p.wasted[i] and s > 0.7:
                    ax.text(x + rad * 0.9, y - rad * 0.9, f"✕{p.wasted[i]}", fontsize=9, color=AMBER, fontweight="bold", zorder=5)
            for a, b, r, k in p.transfers:
                (x0, y0), (x1, y1) = pos[a], pos[b]
                ax.add_patch(FancyArrowPatch((x0, y0), (x1, y1), arrowstyle="-|>", mutation_scale=10,
                                             color=TEAL, alpha=0.35, lw=1.5, connectionstyle="arc3,rad=0.15", zorder=1))
                dots = min(k, 6)
                for d in range(dots):
                    f = min(1, max(0, s * 1.4 - d * 0.08))
                    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
                    nx, ny = -(y1 - y0) * 0.15, (x1 - x0) * 0.15
                    bx = (1 - f) ** 2 * x0 + 2 * (1 - f) * f * (mx + nx) + f * f * x1
                    by = (1 - f) ** 2 * y0 + 2 * (1 - f) * f * (my + ny) + f * f * y1
                    ax.add_patch(Circle((bx, by), 0.025, color=life_color(r, P.life), zorder=6))
                ax.text((x0 + x1) / 2 + nx * 1.2, (y0 + y1) / 2 + ny * 1.2, f"×{k}", fontsize=8, color=TEAL, ha="center")
        fig.suptitle("Bars = stock by life left (amber = expiring, teal = fresh).  Dots = items in transit.",
                     x=0.02, ha="left", fontsize=9, color=MUTED)

    anim = animation.FuncAnimation(fig, draw, frames=periods * substeps, interval=1000 / fps)
    anim.save(path, writer=animation.PillowWriter(fps=fps), dpi=80)
    plt.close(fig)
