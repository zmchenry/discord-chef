import { ArrowLeft } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import type { Recipe } from "../../../shared/schema";
import { Button, LinkButton, StateMessage, TextAreaField, TextField } from "../components/ui";
import { emptyForm, formToInput, recipeToForm, validateForm, type FormErrors, type RecipeFormValues } from "../lib/recipeForm";
import { ApiError } from "../lib/api";
import { useRecipe, useSaveRecipe } from "../lib/queries";

// /recipes/new and /recipes/:id/edit.
export function RecipeEditPage() {
  const { id } = useParams();
  const existing = useRecipe(id);
  if (id && existing.isPending) return <StateMessage title="Loading…" />;
  if (id && existing.isError) return <StateMessage title="Couldn't load this recipe">{existing.error.message}</StateMessage>;
  return <RecipeForm key={id ?? "new"} base={existing.data} />;
}

export function RecipeForm({ base }: { base?: Recipe }) {
  const [values, setValues] = useState<RecipeFormValues>(() => (base ? recipeToForm(base) : emptyForm));
  const [errors, setErrors] = useState<FormErrors>({});
  const save = useSaveRecipe(base?.id);
  const navigate = useNavigate();

  const bind = (key: keyof RecipeFormValues) => ({
    name: key,
    value: values[key],
    error: errors[key],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value })),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateForm(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    save.mutate(formToInput(values, base), {
      onSuccess: (recipe) => navigate(`/recipes/${recipe.id}`, { replace: true }),
    });
  };

  const backTo = base ? `/recipes/${base.id}` : "/recipes";

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 px-4 pt-3" aria-labelledby="recipe-form-title">
      <div className="flex items-center gap-2">
        <LinkButton to={backTo} variant="ghost" aria-label="Cancel" className="-ml-3 px-3">
          <ArrowLeft size={20} aria-hidden="true" />
        </LinkButton>
        <h1 id="recipe-form-title" className="m-0 text-2xl">
          {base ? "Edit recipe" : "New recipe"}
        </h1>
      </div>

      <TextField label="Title" required autoComplete="off" {...bind("title")} />
      <TextField label="Tags" hint="Comma-separated, e.g. dinner, fast" autoComplete="off" {...bind("tags")} />

      <div className="grid grid-cols-3 gap-3">
        <TextField label="Servings" inputMode="numeric" {...bind("servings")} />
        <TextField label="Prep min" inputMode="numeric" {...bind("prepMinutes")} />
        <TextField label="Cook min" inputMode="numeric" {...bind("cookMinutes")} />
      </div>

      <TextAreaField label="Ingredients" hint="One per line" rows={6} {...bind("ingredients")} />
      <TextAreaField label="Steps" hint="One per line" rows={6} {...bind("instructions")} />
      <TextField label="Source link" type="url" inputMode="url" placeholder="https://" {...bind("sourceUrl")} />

      {save.isError &&
        (save.error instanceof ApiError && save.error.existingId ? (
          <p role="alert" className="m-0 font-semibold text-danger">
            A recipe with this title already exists.{" "}
            <Link to={`/recipes/${save.error.existingId}`} className="inline-flex min-h-11 items-center text-primary">
              Open it
            </Link>
          </p>
        ) : (
          <p role="alert" className="m-0 font-semibold text-danger">
            Couldn't save: {save.error.message}
          </p>
        ))}

      <div className="flex gap-3 pb-4">
        <Button type="submit" disabled={save.isPending} className="flex-1">
          {save.isPending ? "Saving…" : "Save recipe"}
        </Button>
        <LinkButton to={backTo} variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
