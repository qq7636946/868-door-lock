/**
 * 868 Pressurized Door Lock — gallery interactions
 *
 * Infinite parallax gallery, slide reveals and Flip image-to-content
 * transitions, adapted from the "list" demo (Codrops, GSAP) into a single
 * classic script so the page also runs straight from the file system.
 */
(() => {
  "use strict";

  // Without GSAP (offline CDN) fall back to a static page
  if (!window.gsap) {
    document.body.classList.remove("loading", "is-film");
    document.querySelector(".loader")?.remove();
    document.querySelector(".banner")?.remove();
    return;
  }

  gsap.registerPlugin(Flip, Observer, SplitText, DrawSVGPlugin);

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------ */
  /* verticalLoop: animate items along the y-axis in an endless loop    */
  /* ------------------------------------------------------------------ */

  function verticalLoop(items, config = {}) {
    items = gsap.utils.toArray(items);

    // Endless timeline
    const tl = gsap.timeline({
      repeat: config.repeat,
      paused: config.paused,
      defaults: { ease: "none" },
      onReverseComplete: () => {
        // Keep the playhead in range when playing backwards past zero
        tl.totalTime(tl.rawTime() + tl.duration() * 100);
      },
    });

    const length = items.length;
    const startY = 0;
    const heights = [];
    const yPercents = [];

    // Travel speed: speed 1 = 100px per second
    const pixelsPerSecond = (config.speed || 1) * 100;

    // Round yPercent values so items land on whole pixels
    const snap = config.snap === false ? (v) => v : gsap.utils.snap(config.snap || 1);

    // Measure each item and convert its y into a height-relative yPercent
    gsap.set(items, {
      yPercent: (i, el) => {
        const h = (heights[i] = parseFloat(gsap.getProperty(el, "height", "px")));
        yPercents[i] = snap(
          (parseFloat(gsap.getProperty(el, "y", "px")) / h) * 100 + gsap.getProperty(el, "yPercent"),
        );
        return yPercents[i];
      },
    });
    gsap.set(items, { y: 0 });

    // Full container length, including the spacing at the wrap seam
    const totalHeight =
      items[length - 1].offsetTop +
      (yPercents[length - 1] / 100) * heights[length - 1] -
      startY +
      items[length - 1].offsetHeight * gsap.getProperty(items[length - 1], "scaleY") +
      (parseFloat(config.paddingBottom) || 0);

    // Two tweens per item: exit top, then re-enter from the bottom
    for (let i = 0; i < length; i++) {
      const item = items[i];
      const curY = (yPercents[i] / 100) * heights[i];
      const distanceToStart = item.offsetTop + curY - startY;
      const distanceToLoop = distanceToStart + heights[i] * gsap.getProperty(item, "scaleY");

      tl.to(
        item,
        {
          yPercent: snap(((curY - distanceToLoop) / heights[i]) * 100),
          duration: distanceToLoop / pixelsPerSecond,
        },
        0,
      ).fromTo(
        item,
        { yPercent: snap(((curY - distanceToLoop + totalHeight) / heights[i]) * 100) },
        {
          yPercent: yPercents[i],
          duration: (totalHeight - distanceToLoop) / pixelsPerSecond,
          immediateRender: false,
        },
        distanceToLoop / pixelsPerSecond,
      );
    }

    // Pre-render every tween to avoid a first-frame jump
    tl.progress(1, true).progress(0, true);

    return tl;
  }

  /* ------------------------------------------------------------------ */
  /* Reveal: show each slide (image + caption) as it enters the viewport */
  /* ------------------------------------------------------------------ */

  const HIDDEN = "inset(100% 0% 0% 0%)";
  const SHOWN = "inset(0% 0% 0% 0%)";

  class Reveal {
    constructor() {
      this.items = new Map();

      gsap.utils.toArray(".gallery__slide").forEach((slide) => {
        const wrapper = slide.querySelector(".gallery__img-wrapper");
        const img = wrapper.querySelector("img");
        const chars = new SplitText(slide.querySelector("figcaption"), { type: "chars" }).chars;

        // Resting state: image curtained, caption invisible
        gsap.set(wrapper, { autoAlpha: 0, clipPath: HIDDEN });
        gsap.set(chars, { autoAlpha: 0 });

        this.items.set(slide, { wrapper, img, chars });
      });
    }

    /** Show slides that entered, top to bottom, reset the ones that left */
    toggle(changes, immediate = false) {
      changes
        .filter((change) => change.visible)
        .sort((a, b) => a.top - b.top)
        .forEach((change, i) => this.show(change.el, i * 0.12, immediate));

      changes.filter((change) => !change.visible).forEach((change) => this.hide(change.el));
    }

    /** Lift the curtain on the image, then type the caption in */
    show(slide, delay, immediate = false) {
      const { wrapper, img, chars } = this.items.get(slide);

      // The viewport moved around the slide, so there is no entrance to play
      if (immediate) {
        gsap.set(wrapper, { autoAlpha: 1, clipPath: SHOWN, overwrite: true });
        gsap.set(img, { scale: 1.2, overwrite: "auto" });
        gsap.set(chars, { autoAlpha: 1, overwrite: true });
        return;
      }

      gsap.to(wrapper, {
        autoAlpha: 1,
        clipPath: SHOWN,
        duration: 1.3,
        ease: "power3.out",
        delay,
        overwrite: true,
      });

      gsap.fromTo(
        img,
        { scale: 1.45 },
        { scale: 1.2, duration: 1.7, ease: "power3.out", delay, overwrite: "auto" },
      );

      gsap.to(chars, {
        autoAlpha: 1,
        duration: 0.4,
        ease: "none",
        stagger: 0.025,
        delay: delay + 0.3,
        overwrite: true,
      });
    }

    /** Reset instantly so the reveal replays on the next entry */
    hide(slide) {
      const { wrapper, chars } = this.items.get(slide);

      gsap.set(wrapper, { autoAlpha: 0, clipPath: HIDDEN, overwrite: true });
      gsap.set(chars, { autoAlpha: 0, overwrite: true });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Slider: infinite gallery driven by wheel, touch and drag            */
  /* ------------------------------------------------------------------ */

  class Slider {
    constructor({ enabled = () => true, onToggle, onActive } = {}) {
      this.enabled = enabled;

      // Called with the slides that just entered or left the viewport
      this.onToggle = onToggle;

      // Called with the index of the slide nearest the viewport center
      this.onActive = onActive;
      this.active = -1;

      // Phones stack wide slides in one column, so they get less depth
      this.narrow = window.matchMedia("(max-width: 760px)");

      this.createLoop();
      this.createParallax();
      this.createScrub();
      this.createObserver();

      this.resize();
    }

    /** Build vertical loop from the gallery slides */
    createLoop() {
      const gallery = document.querySelector(".gallery");

      // The gap between slides doubles as the loop's bottom padding
      const gap = parseFloat(getComputedStyle(gallery).rowGap);

      // A paused one lap timeline; its playhead is our scroll position
      this.loop = verticalLoop(".gallery__slide", {
        repeat: -1,
        paused: true,
        paddingBottom: gap,
      });

      // Wrapping the playhead past either end is what makes it endless
      this.wrap = gsap.utils.wrap(0, this.loop.duration());
    }

    /** Give each slide its own travel speed for a sense of depth */
    createParallax() {
      const speeds = [1.3, 0.8, 1.15, 0.7, 1.25, 0.85];

      this.parallax = gsap.utils.toArray(".gallery__slide").map((slide, i) => ({
        el: slide,
        img: slide.querySelector(".gallery__img"),
        index: i,
        factor: speeds[i % speeds.length] - 1,
        offset: 0,
        visible: false,
      }));

      this.applyParallax();
    }

    /** Offset each slide by its speed factor, report viewport enters/leaves */
    applyParallax(immediate = false) {
      const changes = [];
      const vh = window.innerHeight;
      const depth = this.narrow.matches ? 0.35 : 1;
      let closest = null;
      let closestDistance = Infinity;

      this.parallax.forEach((item) => {
        const rect = item.el.getBoundingClientRect();

        // The slide's position without our offset
        const loopTop = rect.top - item.offset;

        // Offset by the speed factor; zero at the wrap point
        item.offset = item.factor * depth * (loopTop + rect.height);
        gsap.set(item.el, { y: item.offset });

        const top = loopTop + item.offset;
        const visible = top < vh && top + rect.height > 0;

        if (visible) {
          const center = top + rect.height / 2;

          // Drift the photo inside its frame for a second layer of depth
          const drift = gsap.utils.clamp(-1, 1, (center - vh / 2) / vh);
          gsap.set(item.img, { yPercent: drift * -6 });

          const distance = Math.abs(center - vh / 2);
          if (distance < closestDistance) {
            closestDistance = distance;
            closest = item;
          }
        }

        // Collect the slides that entered or left
        if (visible !== item.visible) {
          item.visible = visible;
          changes.push({ el: item.el, visible, top });
        }
      });

      if (changes.length) this.onToggle?.(changes, immediate);

      if (closest && closest.index !== this.active) {
        this.active = closest.index;
        this.onActive?.(closest.index);
      }
    }

    /** Create the eased playhead that smooths scroll input into loop time */
    createScrub() {
      this.playhead = { time: 0 };

      this.scrub = gsap.to(this.playhead, {
        time: 0,
        duration: 0.75,
        ease: "power3.out",
        paused: true,
        onUpdate: () => {
          this.loop.time(this.wrap(this.playhead.time));
          this.applyParallax();
        },
      });
    }

    /** Listen for wheel, touch and mouse drag input */
    createObserver() {
      this.observer = Observer.create({
        target: window,
        type: "wheel,touch,pointer",
        preventDefault: true,
        dragMinimum: 4,
        onChange: (self) => this.scroll(self),
        onDragStart: () => document.body.classList.add("is-dragging"),
        onDragEnd: () => document.body.classList.remove("is-dragging"),
      });
    }

    /** Rebuild the loop when the viewport size settles */
    resize() {
      let id;

      window.addEventListener("resize", () => {
        clearTimeout(id);
        id = setTimeout(() => this.rebuild(), 200);
      });
    }

    /** Move the scrub target by the scrolled or dragged distance */
    scroll({ deltaX, deltaY, event }) {
      if (!this.enabled()) return;

      let delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;

      // Drags grab the gallery: pulling up moves the slides up
      if (event && event.type !== "wheel") delta *= -1.6;

      this.nudge(delta);
    }

    /** Slides travel 100px per playhead second, so px / 100 gives time */
    nudge(px) {
      if (!this.enabled()) return;

      this.scrub.vars.time += px / 100;
      this.scrub.invalidate().restart();
    }

    /** Freeze the inertia in place so a transition can take over */
    freeze() {
      this.scrub.pause();
      this.scrub.vars.time = this.playhead.time;
      this.scrub.invalidate();
    }

    /** Hand the gallery over to a transition */
    stop() {
      this.observer.disable();
      this.freeze();
    }

    /** Take the gallery back once a transition has finished with it */
    start() {
      this.observer.enable();
    }

    /** Re-measure and rebuild the loop, preserving the current position */
    rebuild() {
      const progress = this.loop.progress();

      // Drop the old timeline and its transforms; the stagger lives in the CSS
      this.freeze();
      this.loop.kill();
      gsap.set(".gallery__slide", { clearProps: "transform" });

      this.createLoop();
      this.loop.progress(progress, true);

      // Re-measured rather than travelled, so the reveals snap, not replay
      this.parallax.forEach((item) => (item.offset = 0));
      this.applyParallax(true);

      this.playhead.time = this.loop.time();
      this.scrub.vars.time = this.playhead.time;
      this.scrub.invalidate();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Transition: image-to-content Flip                                   */
  /* ------------------------------------------------------------------ */

  class Transition {
    constructor({ onOpen, onClose } = {}) {
      this.onOpen = onOpen;
      this.onClose = onClose;

      this.content = $(".content");
      this.list = $(".content__group-list");
      this.preview = $(".content__preview-img");
      this.previewImg = this.preview.querySelector("img");

      this.groups = gsap.utils.toArray(".content__group");
      this.slides = gsap.utils.toArray(".gallery__slide");

      this.activeSlide = null;
      this.tl = null;
      this.split = null;

      // closed | opening | open | closing
      this.state = "closed";

      this.preview.dataset.flipId = "preview";
    }

    /** Animate the clicked slide into the preview */
    async open(slide, index) {
      if (this.state !== "closed") return;
      this.state = "opening";
      this.activeSlide = slide;
      this.onOpen?.();

      await this.fillContent(slide, index);

      // A close() landing while the preview decoded has already reset us
      if (this.state !== "opening") return;

      const { wrapper, caption, others, thumb } = this.parts();
      wrapper.dataset.flipId = "preview";

      // Capture the thumbnail's bounds before the layout changes
      const state = Flip.getState(wrapper);

      gsap.set(this.content, { display: "block" });
      this.list.scrollTop = 0;
      document.body.classList.add("is-detail");

      gsap.killTweensOf(wrapper);
      gsap.set(wrapper, { autoAlpha: 0 });

      // Start the preview photo exactly where the thumbnail's drift left it
      gsap.set(this.previewImg, { yPercent: gsap.getProperty(thumb, "yPercent") });

      this.split = new SplitText(".content__back, .content__group.active > *", {
        type: "lines,chars",
        charsClass: "char",
      });

      this.tl = gsap
        .timeline({
          onComplete: () => (this.state = "open"),
          onReverseComplete: () => this.reset(),
        })
        .to(others, { autoAlpha: 0, duration: 0.5, ease: "power2.out" }, 0)
        .to(caption, { autoAlpha: 0, duration: 0.3, ease: "power2.out" }, 0)
        .add(
          Flip.from(state, {
            targets: this.preview,
            duration: 1.2,
            ease: "power4.inOut",
            absolute: true,
          }),
          0,
        )
        .to(this.previewImg, { scale: 1, yPercent: 0, duration: 1.2, ease: "power4.inOut" }, 0);

      // Fade the text in character by character, one line after another
      this.split.lines.forEach((line, i) => {
        this.tl.fromTo(
          line.querySelectorAll(".char"),
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: 1, ease: "power3.out", stagger: 0.01 },
          0.8 + i * 0.05,
        );
      });
    }

    /** Animate the preview back into its slide */
    close() {
      if (this.state === "opening") {
        this.state = "closing";
        document.body.classList.remove("is-detail");

        if (!this.tl) {
          this.reset();
          return;
        }

        this.tl.reverse();
        return;
      }

      if (this.state !== "open") return;
      this.state = "closing";
      document.body.classList.remove("is-detail");

      const { wrapper, caption, others, thumb } = this.parts();

      this.tl = gsap
        .timeline({ onComplete: () => this.reset() })
        .to(this.split.lines, { autoAlpha: 0, duration: 0.4, stagger: 0.03, ease: "power1.out" }, 0)
        .add(
          Flip.fit(this.preview, wrapper, {
            duration: 1,
            ease: "power3.inOut",
            absolute: true,
          }),
          0,
        )
        .to(
          this.previewImg,
          { scale: 1.2, yPercent: gsap.getProperty(thumb, "yPercent"), duration: 1, ease: "power3.inOut" },
          0,
        )
        .to(others, { autoAlpha: 1, duration: 0.5, ease: "power2.out" }, 0.5)
        .to(caption, { autoAlpha: 1, duration: 0.4, ease: "power2.out" }, 0.6);
    }

    /** Copy the clicked image into the preview and activate its content group */
    async fillContent(slide, index) {
      const img = slide.querySelector(".gallery__img");

      this.previewImg.src = img.src;
      this.previewImg.alt = img.alt;
      this.previewImg.style.objectPosition = img.style.objectPosition;

      this.groups.forEach((group) =>
        group.classList.toggle("active", Number(group.dataset.index) === index),
      );

      // Undecoded, the preview paints blank for the first frames of the morph.
      // Background tabs can hold decode() back, so never wait on it for long.
      try {
        await Promise.race([
          this.previewImg.decode(),
          new Promise((resolve) => setTimeout(resolve, 400)),
        ]);
      } catch {
        // Rejects if the src is swapped mid-flight; the transition still runs
      }
    }

    /** Collect the pieces of the active slide the animations need */
    parts() {
      const slide = this.activeSlide;

      return {
        wrapper: slide.querySelector(".gallery__img-wrapper"),
        thumb: slide.querySelector(".gallery__img"),
        caption: slide.querySelector("figcaption"),
        others: this.slides.filter((s) => s !== slide),
      };
    }

    /** Restore the DOM */
    reset() {
      const { wrapper } = this.parts();

      delete wrapper.dataset.flipId;

      this.split?.revert();
      this.split = null;

      gsap.set(this.content, { display: "none" });
      gsap.set(this.preview, { clearProps: "all" });
      gsap.set(this.previewImg, { clearProps: "all" });
      gsap.set(wrapper, { clearProps: "all" });

      this.activeSlide = null;
      this.tl = null;
      this.state = "closed";

      this.onClose?.();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Specs: technical sheet overlay with drawn dimensions                */
  /* ------------------------------------------------------------------ */

  class Specs {
    constructor({ onOpen, onClose } = {}) {
      this.onOpen = onOpen;
      this.onClose = onClose;

      this.el = $(".specs");
      this.title = $(".specs__title");
      this.close_ = $(".specs__close");

      this.lines = $$(".specs__drawing .draw");
      this.labels = $$(".specs__drawing text");
      this.fades = $$("[data-fade]", this.el);
      this.rows = $$(".specs__row");
      this.swatches = $$(".swatch");
      this.numbers = $$(".specs__value [data-value]");

      this.state = "closed";
      this.tl = null;
      this.split = null;

      this.linkDimensions();
    }

    /** Hovering a row lights up its dimension in the drawing, and back */
    linkDimensions() {
      const linked = $$("[data-dim]", this.el);

      linked.forEach((el) => {
        const peers = linked.filter((other) => other.dataset.dim === el.dataset.dim);

        el.addEventListener("pointerenter", () => peers.forEach((p) => p.classList.add("is-hot")));
        el.addEventListener("pointerleave", () => peers.forEach((p) => p.classList.remove("is-hot")));
      });
    }

    open() {
      if (this.state !== "closed") return;
      this.state = "opening";
      this.onOpen?.();

      document.body.classList.add("is-specs");
      this.el.setAttribute("aria-hidden", "false");
      gsap.set(this.el, { display: "block", clipPath: HIDDEN });
      this.el.scrollTop = 0;

      this.split = SplitText.create(this.title, { type: "chars", mask: "chars" });

      const tl = (this.tl = gsap.timeline({
        onComplete: () => {
          this.state = "open";
          this.close_.focus({ preventScroll: true });
        },
      }));

      tl.to(this.el, { clipPath: SHOWN, duration: 1.1, ease: "power4.inOut" }, 0)
        .from(this.split.chars, { yPercent: 110, duration: 1.3, ease: "expo.out", stagger: 0.08 }, 0.55)
        .from(this.fades, { autoAlpha: 0, y: 18, duration: 0.9, ease: "power3.out", stagger: 0.05 }, 0.7)
        .from(this.lines, { drawSVG: "0%", duration: 1.5, ease: "power2.inOut", stagger: 0.02 }, 0.7)
        .from(this.labels, { autoAlpha: 0, duration: 0.6, ease: "none", stagger: 0.06 }, 1.7)
        .from(this.rows, { autoAlpha: 0, y: 12, duration: 0.7, ease: "power3.out", stagger: 0.045 }, 0.85)
        .from(this.swatches, { autoAlpha: 0, scale: 0.4, duration: 0.9, ease: "back.out(2)", stagger: 0.07 }, 1.35);

      // Count every dimension up from zero
      this.numbers.forEach((el, i) => {
        const target = parseFloat(el.dataset.value);
        const decimals = (el.dataset.value.split(".")[1] || "").length;
        const proxy = { v: 0 };

        el.textContent = (0).toFixed(decimals);

        tl.to(
          proxy,
          {
            v: target,
            duration: 1.4,
            ease: "power3.out",
            onUpdate: () => (el.textContent = proxy.v.toFixed(decimals)),
          },
          0.95 + i * 0.05,
        );
      });
    }

    close() {
      if (this.state === "closed" || this.state === "closing") return;
      this.state = "closing";

      document.body.classList.remove("is-specs");
      this.tl?.pause();

      gsap.to(this.el, {
        clipPath: "inset(0% 0% 100% 0%)",
        duration: 0.9,
        ease: "power4.inOut",
        onComplete: () => this.reset(),
      });
    }

    reset() {
      this.tl?.kill();
      this.tl = null;

      this.split?.revert();
      this.split = null;

      // Clear what the entrance left behind so the next one starts clean
      gsap.set(this.lines, { clearProps: "strokeDasharray,strokeDashoffset" });
      gsap.set([...this.labels, ...this.fades, ...this.rows, ...this.swatches], {
        clearProps: "opacity,visibility,transform",
      });
      this.numbers.forEach((el) => (el.textContent = el.dataset.value));

      gsap.set(this.el, { display: "none", clearProps: "clipPath" });
      this.el.setAttribute("aria-hidden", "true");
      this.state = "closed";

      this.onClose?.();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Banner: full-screen film that opens the page                       */
  /* ------------------------------------------------------------------ */

  const formatTime = (t) => {
    const s = Math.floor(t || 0);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  class Banner {
    constructor({ onExit, onEnter } = {}) {
      // onExit fires as the banner starts leaving, onEnter as it starts arriving
      this.onExit = onExit;
      this.onEnter = onEnter;

      this.el = $(".banner");
      this.video = $(".banner__video");
      this.title = $(".banner__title");
      this.fades = $$(".banner__top, .banner__eyebrow, .banner__lead, .banner__bottom");
      this.toggleBtn = $(".banner__toggle");
      this.time = $(".banner__time");
      this.bar = $(".banner__bar span");

      // intro | open | closing | closed | opening
      this.state = "intro";
      this.paused = reducedMotion;
      this.second = -1;

      this.split = SplitText.create(this.title, { type: "lines", mask: "lines" });

      // Resting state until the loader lifts
      gsap.set(this.split.lines, { yPercent: 105 });
      gsap.set(this.fades, { autoAlpha: 0 });

      this.bindVideo();
      this.bindControls();

      // Scrolling down (or swiping up) on the film leads into the gallery
      this.observer = Observer.create({
        target: window,
        type: "wheel,touch",
        preventDefault: true,
        tolerance: 10,
        onChange: (self) => {
          const isWheel = self.event?.type === "wheel";
          if ((isWheel && self.deltaY > 0) || (!isWheel && self.deltaY < 0)) this.exit();
        },
      });
      this.observer.disable();
    }

    bindVideo() {
      const { video } = this;

      if (reducedMotion) {
        video.removeAttribute("autoplay");
        video.pause();
      }

      const setDuration = () =>
        $$(".banner__duration").forEach((el) => (el.textContent = formatTime(video.duration)));

      if (video.readyState >= 1) setDuration();
      else video.addEventListener("loadedmetadata", setDuration, { once: true });

      // Keep the timeline in step with playback while the film is on screen
      gsap.ticker.add(() => {
        if (this.state === "closed" || !video.duration) return;

        gsap.set(this.bar, { scaleX: video.currentTime / video.duration });

        const second = Math.floor(video.currentTime);
        if (second !== this.second) {
          this.second = second;
          this.time.textContent = formatTime(second);
        }
      });

      this.syncToggle();
    }

    bindControls() {
      this.toggleBtn.addEventListener("click", () => {
        this.paused = !this.paused;
        if (this.paused) this.video.pause();
        else this.play();
        this.syncToggle();
      });

      $$("[data-film-exit]").forEach((btn) => btn.addEventListener("click", () => this.exit()));
    }

    syncToggle() {
      this.toggleBtn.textContent = this.paused ? "Play" : "Pause";
      this.toggleBtn.setAttribute("aria-pressed", String(this.paused));
    }

    play() {
      if (this.paused) return;

      // Browsers that refuse autoplay leave the film paused behind a Play button
      this.video.play()?.catch(() => {
        this.paused = true;
        this.syncToggle();
      });
    }

    /** Raise the headline line by line and bring in the furniture */
    reveal() {
      return gsap
        .timeline()
        .fromTo(this.split.lines, { yPercent: 105 }, { yPercent: 0, duration: 1.4, ease: "expo.out", stagger: 0.12 }, 0)
        .fromTo(
          this.fades,
          { autoAlpha: 0, y: 14 },
          { autoAlpha: 1, y: 0, duration: 1, ease: "power3.out", stagger: 0.08 },
          0.35,
        );
    }

    /** First appearance, as the loader lifts */
    intro() {
      this.video.currentTime = 0;
      this.play();

      return gsap
        .timeline({
          onComplete: () => {
            this.state = "open";
            this.observer.enable();
          },
        })
        .fromTo(this.video, { scale: 1.15 }, { scale: 1, duration: 2.6, ease: "power3.out" }, 0)
        .add(this.reveal(), 0.4);
    }

    /** Sweep the film up and away */
    exit() {
      if (this.state !== "open") return;
      this.state = "closing";
      this.observer.disable();

      document.body.classList.remove("is-film");
      this.onExit?.();

      gsap
        .timeline({
          onComplete: () => {
            gsap.set(this.el, { display: "none" });
            this.video.pause();
            this.state = "closed";
          },
        })
        .to(this.split.lines, { yPercent: -105, duration: 0.7, ease: "power3.in", stagger: 0.05 }, 0)
        .to(this.fades, { autoAlpha: 0, duration: 0.4, ease: "power1.out" }, 0)
        .fromTo(
          this.el,
          { clipPath: SHOWN },
          { clipPath: "inset(0% 0% 100% 0%)", duration: 1.2, ease: "power4.inOut" },
          0.2,
        )
        .to(this.video, { yPercent: -18, scale: 1.08, duration: 1.2, ease: "power4.inOut" }, 0.2);
    }

    /** Bring the film back from below */
    open() {
      if (this.state !== "closed") return;
      this.state = "opening";

      document.body.classList.add("is-film");
      this.onEnter?.();

      gsap.set(this.el, { display: "block" });
      gsap.set(this.video, { yPercent: 0, scale: 1.12 });
      gsap.set(this.split.lines, { yPercent: 105 });
      gsap.set(this.fades, { autoAlpha: 0 });
      this.play();

      gsap
        .timeline({
          onComplete: () => {
            this.state = "open";
            this.observer.enable();
          },
        })
        .fromTo(
          this.el,
          { clipPath: "inset(100% 0% 0% 0%)" },
          { clipPath: SHOWN, duration: 1.2, ease: "power4.inOut" },
          0,
        )
        .to(this.video, { scale: 1, duration: 2, ease: "power3.out" }, 0)
        .add(this.reveal(), 0.6);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Cursor follower                                                    */
  /* ------------------------------------------------------------------ */

  function createCursor() {
    const el = $(".cursor");

    if (!finePointer || !el) return { view() {} };

    const xTo = gsap.quickTo(el, "x", { duration: 0.45, ease: "power3" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.45, ease: "power3" });
    let shown = false;

    window.addEventListener("pointermove", (e) => {
      if (!shown) {
        shown = true;
        gsap.set(el, { x: e.clientX, y: e.clientY });
        gsap.to(el, { autoAlpha: 1, duration: 0.4 });
      }

      xTo(e.clientX);
      yTo(e.clientY);
    });

    document.documentElement.addEventListener("pointerleave", () => {
      shown = false;
      gsap.to(el, { autoAlpha: 0, duration: 0.3 });
    });

    return {
      view: (on) => el.classList.toggle("is-view", on),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Frame counter                                                      */
  /* ------------------------------------------------------------------ */

  function createCounter(total) {
    const current = $(".frame__count-current");
    const title = $(".frame__count-title");
    const fill = $(".frame__progress span");
    const titles = $$(".gallery__slide").map((slide) => slide.dataset.title);

    return (index) => {
      const n = String(index + 1).padStart(2, "0");

      gsap.to([current, title], {
        autoAlpha: 0,
        y: -6,
        duration: 0.18,
        ease: "power2.in",
        overwrite: true,
        onComplete: () => {
          current.textContent = n;
          title.textContent = titles[index];
          gsap.fromTo(
            [current, title],
            { autoAlpha: 0, y: 6 },
            { autoAlpha: 1, y: 0, duration: 0.4, ease: "power3.out", stagger: 0.04 },
          );
        },
      });

      gsap.to(fill, { scaleX: (index + 1) / total, duration: 0.7, ease: "power3.out", overwrite: true });
    };
  }

  /* ------------------------------------------------------------------ */
  /* Loading                                                            */
  /* ------------------------------------------------------------------ */

  function preload(images, video, onProgress) {
    const total = images.length + (video ? 1 : 0);
    let done = 0;

    const task = (register) =>
      new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          onProgress(++done / total);
          resolve();
        };
        register(finish);
      });

    const tasks = images.map((img) =>
      task((finish) => {
        if (img.complete && img.naturalWidth) return finish();
        img.addEventListener("load", finish, { once: true });
        img.addEventListener("error", finish, { once: true });
      }),
    );

    // Wait until the film can start, but never hold the page hostage to it
    if (video) {
      tasks.push(
        task((finish) => {
          if (video.readyState >= 3) return finish();
          video.addEventListener("canplay", finish, { once: true });
          video.addEventListener("error", finish, { once: true });
          setTimeout(finish, 6000);
        }),
      );
    }

    return Promise.all(tasks);
  }

  const loader = $(".loader");
  const loaderCount = $(".loader__count");
  const loaderBar = $(".loader__bar span");
  const loaded = { v: 0 };

  const renderLoader = () => {
    loaderCount.textContent = String(Math.round(loaded.v)).padStart(3, "0");
    gsap.set(loaderBar, { scaleX: loaded.v / 100 });
  };

  preload($$(".gallery__img"), $(".banner__video"), (p) =>
    gsap.to(loaded, { v: p * 95, duration: 0.5, ease: "power2.out", overwrite: true, onUpdate: renderLoader }),
  )
    .then(() => document.fonts?.ready)
    .then(() => gsap.to(loaded, { v: 100, duration: 0.5, ease: "power2.out", overwrite: true, onUpdate: renderLoader }))
    .then(init);

  /* ------------------------------------------------------------------ */
  /* Init                                                               */
  /* ------------------------------------------------------------------ */

  function init() {
    document.body.classList.remove("loading");

    const slides = $$(".gallery__slide");
    const cursor = createCursor();
    const setActive = createCounter(slides.length);

    // Hide every slide straight away; the slider reveals them later
    const reveal = new Reveal();
    let slider = null;

    const transition = new Transition({
      onOpen: () => cursor.view(false),
      onClose: () => slider?.start(),
    });

    const specs = new Specs({
      onOpen: () => slider?.stop(),
      onClose: () => slider?.start(),
    });

    // The gallery's own entrance plays once, the first time the film leaves
    let galleryStarted = false;

    const startGallery = () => {
      galleryStarted = true;

      const heroSplit = SplitText.create(".hero__title", { type: "chars", mask: "chars" });

      // From-tweens render at once, so everything hides before the film clears
      gsap
        .timeline({ delay: 0.55 })
        .from(heroSplit.chars, { yPercent: 110, duration: 1.6, ease: "expo.out", stagger: 0.09 }, 0)
        .from(
          ".hero__eyebrow, .hero__sub",
          { autoAlpha: 0, y: 12, duration: 1, ease: "power3.out", stagger: 0.12, clearProps: "all" },
          0.4,
        )
        .from(
          ".frame > *",
          { autoAlpha: 0, duration: 1, ease: "power2.out", stagger: 0.07, clearProps: "opacity,visibility" },
          0.6,
        )
        .add(() => {
          document.body.classList.add("is-ready");

          slider = new Slider({
            enabled: galleryFree,
            onToggle: (changes, immediate) => reveal.toggle(changes, immediate),
            onActive: setActive,
          });
        }, 1.0);
    };

    const banner = new Banner({
      onExit: () => (galleryStarted ? slider?.start() : startGallery()),
      onEnter: () => {
        slider?.stop();
        cursor.view(false);
      },
    });

    const galleryFree = () =>
      transition.state === "closed" && specs.state === "closed" && banner.state === "closed";

    // Intro: lift the loader onto the film
    gsap
      .timeline()
      .fromTo(loader, { clipPath: SHOWN }, { clipPath: "inset(0% 0% 100% 0%)", duration: 1.1, ease: "power4.inOut" })
      .set(loader, { display: "none" })
      .add(banner.intro(), 0.2);

    // Slides open into the detail view
    slides.forEach((slide, index) => {
      slide.setAttribute("tabindex", "0");
      slide.setAttribute("role", "button");
      slide.setAttribute("aria-label", `Open ${slide.dataset.title}`);

      // Only give up the gallery if the transition is going to hand it back
      const open = () => {
        if (!slider || !galleryFree()) return;

        slider.stop();
        transition.open(slide, index);
      };

      slide.addEventListener("click", open);

      slide.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });

      slide.addEventListener("pointerenter", () => cursor.view(galleryFree()));
      slide.addEventListener("pointerleave", () => cursor.view(false));
    });

    $(".content__back").addEventListener("click", () => transition.close());

    $$("[data-specs-open]").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (transition.state === "closed") specs.open();
      }),
    );

    $$("[data-specs-close]").forEach((btn) => btn.addEventListener("click", () => specs.close()));

    $$("[data-nav-gallery]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        specs.close();
        transition.close();
      }),
    );

    $$("[data-film-open]").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (transition.state === "closed" && specs.state === "closed") banner.open();
      }),
    );

    document.addEventListener("keydown", (e) => {
      // On the film, the usual "next" keys lead into the gallery
      if (banner.state !== "closed") {
        const onButton = e.target.closest?.("button");
        if (["ArrowDown", "PageDown"].includes(e.key) || (!onButton && ["Enter", " "].includes(e.key))) {
          e.preventDefault();
          banner.exit();
        }
        return;
      }

      if (e.key === "Escape") {
        if (specs.state !== "closed") specs.close();
        else transition.close();
        return;
      }

      if (!slider || !galleryFree()) return;

      const step = { ArrowDown: 260, PageDown: 600, ArrowUp: -260, PageUp: -600 }[e.key];
      if (step) {
        e.preventDefault();
        slider.nudge(step);
      }
    });
  }
})();
