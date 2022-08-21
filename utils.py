import json
import random
from typing import Set
from prettytable import PrettyTable

# Helper function for logging formatted information to the console
def debug(info):
    print(f'{json.dumps(info, indent=2)}')

# Filter stored recipes based on a specific meal (e.g. Breakfast)
def filter_recipes_for_meal(recipes, meal:str):
    if len(recipes) <= 0 or meal == '': 
        return
    
    recipes_for_meal = {}
    for recipe in list(recipes):
        properties = recipe["properties"]
        tags = properties["Tags"]["multi_select"]
        
        for tag in tags:
            if tag['name'] == meal.capitalize():
                name = properties["Name"]['title'][0]["plain_text"]
                recipes_for_meal[name] = recipe

    # Convert to list before returning to make the recipes JSON serializable
    return recipes_for_meal

# Select unique recipes for a specific meal (e.g. Breakfast) and across
# all selected recipes to avoid duplicates in the same day and week
def choose_unique_recipes(recipes, global_recipes: set):
    unique_recipes: Set = set()
    attempts = 0
    while len(unique_recipes) < 7:
        if (attempts > 25):
            raise Exception("Too many attempts to get unique meals")

        attempts += 1

        recipe = random.choice(list(recipes.keys()))

        if (recipe not in global_recipes):
            unique_recipes.add(recipe)
            global_recipes.add(recipe)

    return unique_recipes

# Create a mapping of page (e.g. Chicken N Waffles) to a specific day's relation ID
# Important for relating each day to the specific recipes
def get_page_to_relation_id(query_results, chosen_recipes, chosen_recipes_to_relation_ids):
    page_to_relation_id = dict()
    # Iterate through queried recipes
    for recipe in query_results:
        # If recipe is in flatmap, then we need to set a relation id for it's page id
        # to update Notion with
        name = recipe["properties"]["Name"]["title"][0]["plain_text"]
        page_id = recipe["id"]
        if name in chosen_recipes:
            relation_id = chosen_recipes_to_relation_ids[name]
            # Save relation ID for page ID in format accepted by Notion API
            page_to_relation_id[page_id] = [{'id': relation_id}]
        else:
            # Clear day relations for non-matched meals
            page_to_relation_id[page_id] = []
    return page_to_relation_id

# Create a mapping of recipe name to the day for the recipe
def get_meal_to_relation_id(flat_chosen_recipes, days_relation_ids):
    # Create a mapping of meal -> relation_id to avoid iterating over recipe list multiple times
    chosen_meals_to_relation_ids = dict()
    for index, meal in enumerate(flat_chosen_recipes):
        # The flat list will contain 21 items where meals are grouped by 7 items 
        # relating to the day of the week
        relation_id = days_relation_ids[index % 7]
        chosen_meals_to_relation_ids[meal] = relation_id

    return chosen_meals_to_relation_ids

# Call Notion with new updated recipe and day information
# Track failures to inform user's that manual overrides will be necessary
def update_notion_with_meals(notion_client, page_to_relation_id):
    failures = 0
    # Update notion by passing in new recipe information
    # Iterate through page_to_relation_id keys
    for page in list(page_to_relation_id):
        print(f'Updating page {page}')
        if notion_client.update_recipe_with_day(page, page_to_relation_id[page]) != 200:
            print(f'Updating page {page} failed')
            failures += 1
    
    return failures

# Helper for formatting meal information in a table by day
def format_output(meal_plan):
    table = PrettyTable()
    table.align = 'l'
    table.field_names = ['Day', 'Meals']

    for meal in list(meal_plan.keys()):
        table.add_row([meal, ", ".join(meal_plan[meal])])

    return table

# Helper for formatting meal information in a table by day and meal
def format_output_weekly(meal_plan):
    table = PrettyTable()
    table.align = 'l'
    table.add_column('Meal', ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])

    for meal in list(meal_plan.keys()):
        table.add_column(meal, list(meal_plan[meal]))

    return table