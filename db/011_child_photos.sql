-- Photos stay in NAS PostgreSQL and its existing database backup workflow.
ALTER TABLE public.children ADD COLUMN photo_id uuid;
CREATE TABLE private.child_photos (
 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
 child_id uuid NOT NULL REFERENCES public.children(id),
 family_id uuid NOT NULL REFERENCES public.families(id),
 image bytea NOT NULL CHECK(octet_length(image) BETWEEN 1 AND 1048576),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION public.child_photo(p_child uuid,p_image bytea DEFAULT NULL,p_token text DEFAULT NULL,p_restore uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; photo uuid;
BEGIN
 f:=private.owned_family();
 PERFORM 1 FROM public.children WHERE id=p_child AND family_id=f FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'child_not_found'; END IF;
 IF NOT private.parent_valid(f,p_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
 IF p_image IS NOT NULL THEN
  INSERT INTO private.child_photos(child_id,family_id,image) VALUES(p_child,f,p_image) RETURNING id INTO photo;
 ELSE
  IF p_restore IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.child_photos WHERE id=p_restore AND child_id=p_child AND family_id=f) THEN RAISE EXCEPTION 'child_not_found'; END IF;
  photo:=p_restore;
 END IF;
 UPDATE public.children SET photo_id=photo WHERE id=p_child AND family_id=f;
 RETURN public.get_dashboard();
END $$;
CREATE FUNCTION public.read_child_photo(p_child uuid,p_photo uuid)
RETURNS bytea LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT image FROM private.child_photos WHERE child_id=p_child AND id=p_photo AND family_id=private.owned_family()
$$;
REVOKE ALL ON FUNCTION public.child_photo(uuid,bytea,text,uuid),public.read_child_photo(uuid,uuid) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.child_photo(uuid,bytea,text,uuid),public.read_child_photo(uuid,uuid) TO authenticated;

CREATE FUNCTION public.can_upload_child_photo(p_child uuid,p_token text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid;
BEGIN
 f:=private.owned_family();
 RETURN EXISTS(SELECT 1 FROM public.children WHERE id=p_child AND family_id=f) AND private.parent_valid(f,p_token);
END $$;
REVOKE ALL ON FUNCTION public.can_upload_child_photo(uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.can_upload_child_photo(uuid,text) TO authenticated;
