<div align=center>

<img src="extras/mcla_logo.png" alt="Midnight Club Los Angeles" width="60%">

</div>
<h1 align=center>Midnight Club Los Angeles - Native NX Port</h1>

Native port of the 2008's fourth installment on the Midnight Club series: **Midnight Club Los Angeles from Xbox 360**.

There is no emulation here. None, zilch, nada. It is pure PowerPC code translated to C++ using [ReXGlue](https://github.com/rexglue/rexglue-sdk), thanks to the efforts of the devs of [MCLA-Recomp project](https://github.com/RenanQueiroz/mcla-recomp). 
The game the runs directly with shaders compiled specifically for the Switch, with a launcher compiled to run with the recompiled code. It uses Deko3D as its 3D renderer and targets 30 FPS. Mild CPU overclock might be needed to reach such target. Everything will be explained in this document.

Thanks to StevensND for his port and for the inspiration.

> [!NOTE]
> You need your own Xbox 360 copy of the game (`.iso`) to be able to play this port. This port does not come with copyrighted material. I don't want John Rockstar at my doorstep, y'know.

## How to install

1: Download the Switch executables from [releases](https://github.com/Wivi2013/mcla-nx/releases) and extract it.

2: Send the "switch" folder inside the extracted .rar to the root of the Switch SD card.

3: Visit [MCLA-Recomp project](https://github.com/RenanQueiroz/mcla-recomp) and follow their instructions to recompile your .iso.

4: Locate the game files and copy all of them to switch/MCLA-NX/game

5: Open Sphaira and create a forwarder with 39 bit address space and 4 CPUs.

6: Open game and play (optional)

Your folder should look like this
```text
/switch/MCLA-NX/
  nfsmw-nx.nro
  mcla_graphics.toml        (graphical settings)
  mcla.toml                 (game settings/debug options)
  shaders-c064/             (the game shaders)
  game/                     (the game itself)
```

## Performance

You can expect around 20~ FPS on stock handheld mode at stock clock: `1020/384/1331`. This game is very CPU intensive because of the huge car density and asset loading. On docked clocks (`1785/768/1600`) performance is overall tolerable. As for now (pre-release c230) performance is decent enough to enjoy the game at recommended overclock settings

## Overclocking

Due to the nature of the RAGE engine, you need to overclock your console.

</div>

> [!CAUTION]
> Overclocking is inherently risky so tread carefully. V1 consoles are usually very limited by nature of being older units.
> V2/Lite and OLED consoles can be pushed further because of the updated SOC they have (Tegra X1+).
> Make sure to follow the guides below. I am not responsible by any damage your console may suffer by improper settings.

These guides explain how to do it:

- **[How to get 60 FPS](https://rentry.org/howtoget60fps)**
- **[Mariko guide](https://rentry.co/mariko)**
- **[Erista guide](https://rentry.co/erista)**
- **[How to test stability](https://rentry.co/howtoteststability)**

*Special thanks for the Horizon OC team and discord server*

These are the ""comfortable"" settings that currently (pre-release c230) you can safely run in any console and get a taste of the current progress.

<div align="center">

| Mode | CPU | GPU | Memory |
| --- | --- | --- | --- |
| Handheld | 1683 MHz | 460.8 MHz | 1331 MHz |
| Handheld (Mariko Only*) | 1963 MHz | 537 MHz | 2133 MHz |
| Docked** (Safe for all) | 1963 MHz | 768 MHz | 1600 MHz |
| Docked** (Mariko Only) | 2397 MHz | 1152 MHz | 2133 MHz |

<div align="left">

`Erista = V1. Mariko = V2/Lite/OLED`

*Erista can work with these settings but you need to properly undervolt the console.

**Having the console plugged in with the OEM (Original) Nintendo charger or a PPS PD 15 V compatible charger classifies as docked but uses handheld resolution profile.

- Baseline for performance figures currently: `1683460\1331`. Game set to 360p for consistency with older internal builds. 480p is achievable on such clocks but can potentially struggle.

## Progress

Here you will learn about the relative progress of the game. It does not reflect the results you can get on the current pre-release build since these are numbers
captured from internal builds

<div align="center">

| Component | Status | Note |
| --- | --- | --- |
| Renderer | Complete | Completed in c034 - Swapped to Deko3D on 0.3.0 |
| Audio | Complete | Completed in c036 - Completely fixed in c151 | 
| Controls | Complete | Completed in c037 |
| Graphics | 90% | Needs corrections, specially with objects transparency |
| Gameplay | 90% | Needs bug fixing and extensive testing with late game features |
| Performance | 90% | Game reaches about 23 FPS min on busy scenes. Needs 30 on all occasions |
| Extras | 0% | FSR, First run configurator for controls and external editor for graphical settings |

<div align="left">

## Planned features for Operation Above and Beyond - 1.0

| Component | Status | Description |
| --- | --- | --- |
| FSR | 12% | Minimum requirements met for such tech |
| Keybind customizer | 0% | Planned | 
| Save-file backup tool | 0% | Planned |
| Editor for game settings | 0% | Planned |
| Integrated launcher | 0% | Planned |
  
## Legal

No affiliation with Take-Two or Rockstar Games and Nintendo. "Midnight Club" and "Midnight Club Los Angeles" are trademarks of Take Two Interactive.
This repository contains no assets or program code from the original game. Users must provide their own legally obtained copy. 
Running homebrew requires custom firmware, which is against Nintendo's TOS. Doing so risks a ban on your console. You have been warned.

Source code will be released when I get the time to get everything sorted.
