# 🦟 NoSquito

NoSquito's main interface is a statewide dashboard designed to help Florida mosquito-control teams understand **where mosquito treatment is needed, what environmental conditions are contributing to mosquito activity, and how effective different treatment approaches are expected to be.**

The platform brings mosquito-control operations and NASA weather data into one interactive map, with an integrated machine learning model that predicts how different treatment strategies may reduce mosquito populations.

Users can also interact with the data through **Skeeter**, NoSquito's conversational data assistant.

---

## Problem

Florida mosquito-control agencies collect and use information from many different sources, including mosquito-control activities, environmental conditions, and weather.

However, this information can be difficult to view together when determining:

- Where mosquito treatment is needed
- Which areas should receive attention first
- What environmental conditions may be contributing to mosquito populations
- Which treatment approaches have been used
- How different treatment strategies may affect mosquito populations

NoSquito brings these datasets together into a single statewide decision-support dashboard.

---

## Solution

NoSquito combines three major components:

### 1. Interactive Treatment Map

A statewide Florida map visualizes mosquito-control activity and differentiates areas based on treatment priority.

Users can interact with individual regions to investigate:

- County
- Mosquito control district
- Treatment activity
- Treatment type
- Environmental conditions
- Treatment effectiveness predictions

Priority areas are visually differentiated so users can quickly identify regions requiring greater attention.

---

### 2. NASA Weather Intelligence

Environmental conditions are displayed alongside mosquito-control data to provide additional context for mosquito activity.

The NASA Weather layer includes:

- Rainfall
- Temperature
- Humidity

Users can toggle between map layers to explore the relationship between environmental conditions and mosquito-control activity.

---

# Dashboard Architecture

## Map Layer 1: Mosquito Control

The Mosquito Control layer represents mosquito-control operations across Florida.

### Geographic information
- County
- Mosquito control district

### Treatment methods
- Larviciding
- Adulticiding
- Aerial spraying
- Ground spraying
- *Bacillus thuringiensis israelensis (Bti)*
- Insect Growth Regulators (IGRs)

Users can explore where different control methods are being used and compare treatment activity across regions.

---

## Map Layer 2: NASA Weather

The NASA Weather layer provides environmental context for mosquito activity.

### Environmental variables
- Rainfall
- Temperature
- Humidity

These variables can be viewed alongside mosquito-control activity to help identify environmental conditions associated with mosquito populations and treatment needs.


# Treatment Effectiveness Prediction

The machine learning component estimates how different mosquito-control treatments may affect mosquito populations within a region.

For a selected area, NoSquito can display information such as:

**Treatment:** Larviciding  
**Predicted population reduction:** XX%  
**Environmental conditions:** Favorable / Moderate / Unfavorable  
**Model confidence:** XX%

The model allows users to explore treatment outcomes in the context of regional environmental conditions.

---

# 💬 Ask Skeeter

**Skeeter** is NoSquito's conversational data assistant.

Instead of manually interpreting multiple map layers, users can ask questions about the data in natural language.

### Example questions

> "Which areas currently have the highest treatment priority?"

> "Why is this region high priority?"

> "What treatment methods are being used in this county?"

> "How much is this treatment expected to reduce the mosquito population?"

> "How does rainfall relate to the treatment priority in this region?"

> "Which areas have received treatment?"

Skeeter uses the same underlying dataset as the dashboard so users can move between the map and conversational analysis.

---

# How NoSquito Works

<img width="1206" height="1304" alt="ChatGPT Image Sep 20, 2026, 04_44_06 PM" src="https://github.com/user-attachments/assets/3abee9d1-9ab4-4de5-84bc-45f757a7e143" />

