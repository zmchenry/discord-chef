import os
import discord
import random
import datetime
from constants import PAGE_FOR_WEEKDAY
from notion import NotionClient
from dotenv import load_dotenv
from discord.ext import commands
from utils import choose_unique_recipes, debug, filter_recipes_for_meal, format_output, format_output_weekly, get_meal_to_relation_id, get_page_to_relation_id, update_notion_with_meals

load_dotenv()
client = discord.Client()
bot = commands.Bot(command_prefix='!')

notion_client = NotionClient()

SERVER = os.getenv('DISCORD_SERVER')
TOKEN = os.getenv('DISCORD_TOKEN')

# Initialize random based on the current time
calendar = datetime.datetime.now().isocalendar()
random.seed("{year}{week}".format(week=calendar.week, year=calendar.year))

@bot.command(name='meals', help="Responds with the currently planned meals")
async def meals(ctx: commands.Context):
    print(f'Attempting to display meals for the current week')

    # Get meals planned for each day
    planned_meals = notion_client.query_planned_meals()

    print(f'Adding planned meals to mapping of day to meals for the day')
    meals = dict({})
    # Parse results for name and when the meal is happening
    for planned_meal in planned_meals['results']:
        name = planned_meal["properties"]["Name"]["title"][0]["plain_text"]
        days = planned_meal["properties"]["When"]["relation"]

        # Iterate through the related days for When to account for all days 
        # a planned meal is scheduled for
        for day in days:
            day_of_the_week = PAGE_FOR_WEEKDAY["".join(day["id"].split('-'))]

            # If the day of the week does not have a list of meals yet, create one
            if not day_of_the_week in meals:
                meals[day_of_the_week] = []
            
            meals[day_of_the_week].append(name)
    print(f'Planned meals added for formatting')

    # Pretty format the meals for the week
    table = format_output(meals)

    print(f'Retrieval and formatting of meals successful, sending to chat')
    # Respond with bot message
    await ctx.send('```{table}```'.format(table=table))


@bot.command(name='plan', help="Plans the week if it hasn't been planned")
async def plan(ctx: commands.Context):
    await ctx.send('🧑‍🍳 Planning weekly meals! This may take a few seconds 🥣')   
    print(f'Attempting to schedule meals for the week')

    print(f'Generating random seed for the current week')
    # Generate seed for consistent generation in the same week
    calendar = datetime.datetime.now().isocalendar()
    seed = "{year}{week}".format(week=calendar.week, year=calendar.year)
    random.seed(seed)
    print(f'Seed: {seed}')

    # Query notion to see if there is a plan, if so, do nothing
    query_results = notion_client.query_recipes()
    recipes_from_table = query_results['results']
    print(f'Retrieval of recipes was successful')
    meal_cache = {
        'Breakfast': filter_recipes_for_meal(recipes_from_table, "Breakfast"),
        'Lunch': filter_recipes_for_meal(recipes_from_table, "Lunch"),
        'Dinner': filter_recipes_for_meal(recipes_from_table, "Dinner"),
    }

    meals_for_the_week = dict({
        'Breakfast': [],
        'Lunch': [],
        'Dinner': [],
    })
    print(f'Choosing unique recipes from the recipe table')
    # Create a global chosen set map to prevent duplicates across meals of the week
    chosen_meals = set()
    for meal in list(meals_for_the_week.keys()):
        meals_for_the_week[meal] = list(choose_unique_recipes(meal_cache[meal], chosen_meals))

    print(f'Creating formatted output for weekly recipes')
    # Format the output into a table, saved just in case updating doesn't work, 
    # we can respond and allow user to manually update notion
    table = format_output_weekly(meals_for_the_week)

    # Get the relation IDs as a array for inserting into the data
    days_relation_ids = list(PAGE_FOR_WEEKDAY.keys())

    # Flattened list of meals for creating a map
    flat_chosen_meals = sum(list(meals_for_the_week.values()), list([]))

    # Create a mapping of meal -> relation_id to avoid iterating over recipe list multiple times
    chosen_meals_to_relation_ids = get_meal_to_relation_id(flat_chosen_meals, days_relation_ids)

    page_to_relation_id = get_page_to_relation_id(query_results['results'], flat_chosen_meals, chosen_meals_to_relation_ids)
    print(f'Updating Notion with meal schedule')
    await ctx.send('✏️ Updating Notion with meal schedule 📝')
    failures = update_notion_with_meals(notion_client, page_to_relation_id)

    if failures > 0:
        await ctx.send("Encountered failures when submitting meal plan, manual updates required")
    else:
        print(f'No failures encountered we are gucci')
        
    await ctx.send('```{table}```'.format(table=table))

bot.run(TOKEN)

# TODO: Possible improvements
    # 1. Ability to determine what meal a recipe is scheduled for through Notion
    # 2. Auto-sort recipes for each day by time of day
    # 3. Ability to mark a recipe as manually overridden so it doesn't get overwritten by rerunning !plan
    # 4. Command to replan with a different seed
    # 5. Clear shopping list trip and have feilds on all shopping list items

# TODO: Bugs
    # 1. !plan is not formatting recipes as left aligned