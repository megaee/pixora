from photo_cleanup.analysis import Photo, group_photos, is_image_file


def test_is_image_file():
    assert is_image_file("IMG_1.JPG")
    assert is_image_file("x.png")
    assert not is_image_file("notes.txt")
    assert not is_image_file(".hidden.jpg")


def test_orientation_is_applied(photo_dir):
    p = Photo.analyse(str(photo_dir / "a3.jpg"))
    assert (p.width, p.height) == (800, 600)  # stored 600x800 but displayed landscape


def test_similar_photos_are_close(photo_dir):
    a1, a2, a3, other = (
        Photo.analyse(str(photo_dir / n)) for n in ("a1.jpg", "a2.jpg", "a3.jpg", "other.jpg")
    )
    assert a1.distance(a3) <= 10
    assert a1.distance(a2) < 40
    assert a1.distance(other) > 60


def test_blurry_scores_lower(photo_dir):
    sharp = Photo.analyse(str(photo_dir / "a1.jpg"))
    blurry = Photo.analyse(str(photo_dir / "a_blurry.jpg"))
    assert sharp.sharpness > blurry.sharpness
    assert sharp.score > blurry.score


def test_grouping(photo_dir):
    photos = [Photo.analyse(str(p)) for p in sorted(photo_dir.glob("*.jpg"))]
    groups = group_photos(photos, threshold=40)
    names = [sorted(p.id for p in g) for g in groups]
    assert ["other.jpg"] in names
    big = names[0]
    assert {"a1.jpg", "a2.jpg", "a3.jpg"} <= set(big)


def test_threshold_zero_gives_singletons(photo_dir):
    photos = [Photo.analyse(str(p)) for p in sorted(photo_dir.glob("*.jpg"))]
    groups = group_photos(photos, threshold=0, time_window=0)
    # a1 and a3 are the same pixels (one stored rotated) so they may still match exactly
    assert len(groups) >= 4
